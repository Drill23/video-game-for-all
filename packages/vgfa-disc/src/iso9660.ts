import type { Iso9660Metadata } from './types.js';

export interface ByteReadable {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

const SECTOR_SIZE = 2048;

function decodeAscii(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out.trim();
}

function readU32LE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] |
      (buf[offset + 1] << 8) |
      (buf[offset + 2] << 16) |
      ((buf[offset + 3] << 24) >>> 0)) >>>
    0
  );
}

function inferRegionFromSerial(serial?: string): Iso9660Metadata['region'] {
  if (!serial) return 'UNKNOWN';
  const upper = serial.toUpperCase();
  if (/^(SLUS|SCUS|PAPX)/.test(upper)) return 'NTSC-U';
  if (/^(SLES|SCES|SCED)/.test(upper)) return 'PAL';
  if (/^(SLPS|SLPM|SCPS|SCPM)/.test(upper)) return 'NTSC-J';
  return 'UNKNOWN';
}

function normalizeSerial(bootPath: string): string | undefined {
  // Ex.: "cdrom0:\SLUS_209.46;1" -> "SLUS-20946"
  const m = /([A-Z]{4})[_-](\d{3})\.?(\d{2})/i.exec(bootPath);
  if (!m) return undefined;
  return `${m[1].toUpperCase()}-${m[2]}${m[3]}`;
}

interface DirEntry {
  name: string;
  lba: number;
  size: number;
  isDir: boolean;
}

function parseDirectorySector(buf: Uint8Array): DirEntry[] {
  const entries: DirEntry[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const recordLen = buf[pos];
    if (recordLen === 0) {
      // Pula para o próximo setor de 2048 bytes
      const nextSector = (Math.floor(pos / SECTOR_SIZE) + 1) * SECTOR_SIZE;
      if (nextSector >= buf.length) break;
      pos = nextSector;
      continue;
    }
    if (pos + recordLen > buf.length || recordLen < 34) break;
    const lba = readU32LE(buf, pos + 2);
    const size = readU32LE(buf, pos + 10);
    const flags = buf[pos + 25];
    const nameLen = buf[pos + 32];
    const nameBytes = buf.subarray(pos + 33, pos + 33 + nameLen);
    let name = decodeAscii(nameBytes);
    // Remove sufixo ISO9660 ";1"
    const semi = name.indexOf(';');
    if (semi !== -1) name = name.slice(0, semi);
    entries.push({
      name,
      lba,
      size,
      isDir: (flags & 0x02) !== 0,
    });
    pos += recordLen;
  }
  return entries;
}

/**
 * Lê metadados ISO-9660 / PS1 / PS2 / PSP lendo apenas alguns setores (~16–64 KiB)
 * de uma imagem que pode ter 4,7 GB ou 8,5 GB — sem baixar o disco inteiro!
 */
export async function inspectIso9660(disc: ByteReadable): Promise<Iso9660Metadata> {
  const empty: Iso9660Metadata = {
    validIso9660: false,
    volumeId: '',
    systemId: '',
    volumeSizeBytes: disc.size,
    detectedPlatform: 'unknown',
  };

  if (disc.size < SECTOR_SIZE * 17) {
    return empty;
  }

  // Primary Volume Descriptor fica no setor 16 (offset 32768)
  const pvd = await disc.read(16 * SECTOR_SIZE, SECTOR_SIZE);
  if (pvd.length < 190) return empty;

  const isPvd =
    pvd[0] === 0x01 &&
    pvd[1] === 0x43 && // C
    pvd[2] === 0x44 && // D
    pvd[3] === 0x30 && // 0
    pvd[4] === 0x30 && // 0
    pvd[5] === 0x31; // 1

  if (!isPvd) {
    return empty;
  }

  const systemId = decodeAscii(pvd.subarray(8, 40));
  const volumeId = decodeAscii(pvd.subarray(40, 72));
  const totalSectors = readU32LE(pvd, 80);
  const volumeSizeBytes = totalSectors > 0 ? totalSectors * SECTOR_SIZE : disc.size;

  // Root directory record começa no offset 156 do PVD
  const rootLba = readU32LE(pvd, 156 + 2);
  const rootSize = Math.min(readU32LE(pvd, 156 + 10), 16 * SECTOR_SIZE);

  let detectedPlatform: Iso9660Metadata['detectedPlatform'] = 'unknown';
  if (systemId.toUpperCase().includes('PLAYSTATION')) {
    detectedPlatform = 'ps1';
  }
  if (systemId.toUpperCase().includes('PSP GAME')) {
    detectedPlatform = 'psp';
  }

  let bootFile: string | undefined;
  let serial: string | undefined;
  let videoMode: string | undefined;
  let version: string | undefined;

  if (rootLba > 0 && rootSize > 0) {
    const rootBuf = await disc.read(rootLba * SECTOR_SIZE, rootSize);
    const entries = parseDirectorySector(rootBuf);

    const hasPspGameDir = entries.some((e) => e.isDir && e.name.toUpperCase() === 'PSP_GAME');
    if (hasPspGameDir) {
      detectedPlatform = 'psp';
    }

    const sysCnf = entries.find((e) => !e.isDir && e.name.toUpperCase() === 'SYSTEM.CNF');
    if (sysCnf && sysCnf.size > 0 && sysCnf.size <= 65536) {
      const cnfBytes = await disc.read(sysCnf.lba * SECTOR_SIZE, sysCnf.size);
      const text = new TextDecoder('ascii').decode(cnfBytes);
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const k = line.slice(0, eq).trim().toUpperCase();
        const v = line.slice(eq + 1).trim();
        if (k === 'BOOT2') {
          detectedPlatform = 'ps2';
          bootFile = v;
          serial = normalizeSerial(v);
        } else if (k === 'BOOT' && !bootFile) {
          detectedPlatform = 'ps1';
          bootFile = v;
          serial = normalizeSerial(v);
        } else if (k === 'VMODE') {
          videoMode = v;
        } else if (k === 'VER') {
          version = v;
        }
      }
    }
  }

  return {
    validIso9660: true,
    volumeId,
    systemId,
    volumeSizeBytes,
    detectedPlatform,
    bootFile,
    serial,
    region: inferRegionFromSerial(serial),
    videoMode,
    version,
  };
}
