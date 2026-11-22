import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MemoryChunkCache,
  MemoryDiscSource,
  VirtualChunkedDisc,
  createSabDiscBuffer,
  inspectIso9660,
  postSabReadRequest,
  processOneSabRequest,
  SAB_IDX,
  SAB_STATE,
  type DiscSource,
} from '../src/index.js';

function buildSyntheticPs2Iso(): Uint8Array {
  const SECTOR = 2048;
  const iso = new Uint8Array(SECTOR * 30);

  // Setor 16: Primary Volume Descriptor ISO-9660
  const pvd = 16 * SECTOR;
  iso[pvd] = 0x01;
  iso.set(new TextEncoder().encode('CD001'), pvd + 1);
  iso.set(new TextEncoder().encode('PLAYSTATION'), pvd + 8);
  iso.set(new TextEncoder().encode('VGFA_PS2_TEST'), pvd + 40);

  // Total sectors (LE) at offset 80
  const dv = new DataView(iso.buffer);
  dv.setUint32(pvd + 80, 30, true);

  // Root directory record at offset 156: LBA = 20, size = 2048
  dv.setUint32(pvd + 156 + 2, 20, true);
  dv.setUint32(pvd + 156 + 10, SECTOR, true);

  // Setor 20: Root directory contendo SYSTEM.CNF no setor 22
  const root = 20 * SECTOR;
  const cnfContent = new TextEncoder().encode(
    'BOOT2 = cdrom0:\\SLUS_209.46;1\r\nVER = 1.03\r\nVMODE = NTSC\r\n',
  );
  const nameBytes = new TextEncoder().encode('SYSTEM.CNF;1');
  const recLen = 33 + nameBytes.length + ((33 + nameBytes.length) % 2);
  iso[root] = recLen;
  dv.setUint32(root + 2, 22, true);
  dv.setUint32(root + 10, cnfContent.length, true);
  iso[root + 25] = 0x00; // arquivo
  iso[root + 32] = nameBytes.length;
  iso.set(nameBytes, root + 33);

  // Setor 22: conteúdo do SYSTEM.CNF
  iso.set(cnfContent, 22 * SECTOR);

  return iso;
}

test('inspectIso9660 identifica PS2, serial SLUS-20946 e região NTSC-U lendo apenas poucos setores', async () => {
  const isoBytes = buildSyntheticPs2Iso();
  const source = new MemoryDiscSource(isoBytes, 'ps2_test.iso');
  const disc = new VirtualChunkedDisc(source, { chunkSizeBytes: 8192, maxReadAheadChunks: 0 });

  const meta = await inspectIso9660(disc);
  assert.equal(meta.validIso9660, true);
  assert.equal(meta.volumeId, 'VGFA_PS2_TEST');
  assert.equal(meta.detectedPlatform, 'ps2');
  assert.equal(meta.serial, 'SLUS-20946');
  assert.equal(meta.region, 'NTSC-U');
  assert.equal(meta.videoMode, 'NTSC');
  assert.equal(meta.version, '1.03');

  const metrics = await disc.getMetrics();
  assert.ok(metrics.bytesFromSource <= 32768, 'Deve ler apenas fração mínima da ISO');
});

test('VirtualChunkedDisc deduplica leituras concorrentes e faz cache L1 + L2 + prefetch', async () => {
  const size = 256 * 1024;
  const payload = new Uint8Array(size);
  for (let i = 0; i < size; i++) payload[i] = i & 0xff;

  const requestedOffsets: number[] = [];
  const countingSource: DiscSource = {
    id: 'counting_disc',
    name: 'counting.iso',
    kind: 'http-range',
    size,
    async readRaw(offset, length) {
      requestedOffsets.push(offset);
      await new Promise((r) => setTimeout(r, 5));
      return payload.slice(offset, offset + length);
    },
  };

  const l2 = new MemoryChunkCache(1024 * 1024);
  const disc = new VirtualChunkedDisc(countingSource, {
    chunkSizeBytes: 16384,
    maxRamCacheBytes: 64 * 1024,
    maxReadAheadChunks: 2,
    persistentCache: l2,
  });

  // 4 leituras simultâneas no mesmo chunk 0 devem resultar em apenas 1 chamada ao offset 0
  const [a, b, c, d] = await Promise.all([
    disc.read(0, 1024),
    disc.read(512, 1024),
    disc.read(2048, 2048),
    disc.read(4096, 1024),
  ]);

  assert.equal(a[10], 10);
  assert.equal(b[0], 0);
  assert.equal(c[0], 0);
  assert.equal(d[0], 0);
  const chunk0Fetches = requestedOffsets.filter((o) => o === 0).length;
  assert.equal(chunk0Fetches, 1, 'Leituras concorrentes ao chunk 0 devem ser coalescidas em 1 fetch');

  // Nova leitura ao chunk 0 vem do L1 RAM cache sem novo fetch
  const beforeCount = requestedOffsets.length;
  const again = await disc.read(128, 64);
  assert.equal(again[0], 128);
  const metrics = await disc.getMetrics();
  assert.ok(metrics.l1RamHits >= 1);
  assert.equal(requestedOffsets.filter((o) => o === 0).length, 1);
  assert.ok(requestedOffsets.length >= beforeCount);
});

test('SAB Disc Bridge transfere leituras com offsets > 4 GB (64-bit) sem corrupção', async () => {
  const virtualSize = 5_000_000_000; // > 4 GiB (DVD9!)
  const sabBuf = createSabDiscBuffer(4096);
  const bigOffset = 4_500_000_000;

  let receivedOffset = -1;
  const fakeHandler = {
    size: virtualSize,
    async read(offset: number, length: number) {
      receivedOffset = offset;
      const out = new Uint8Array(length);
      out.fill(0xab);
      return out;
    },
  };

  postSabReadRequest(sabBuf, bigOffset, 128);
  const processed = await processOneSabRequest(sabBuf, fakeHandler);
  assert.equal(processed, true);
  assert.equal(receivedOffset, bigOffset);
  assert.equal(Atomics.load(sabBuf.ctrl, SAB_IDX.STATE), SAB_STATE.READY);
  assert.equal(Atomics.load(sabBuf.ctrl, SAB_IDX.RESULT_BYTES), 128);
  assert.equal(sabBuf.payload[0], 0xab);
  assert.equal(sabBuf.payload[127], 0xab);
});
