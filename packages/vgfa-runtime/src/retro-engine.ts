import { PAD_BIT, type ConsoleId, type PadState } from '@vgfa/pad';
import { CONSOLE_MAP } from './consoles.js';
import { buildProxyStreamUrl } from './archive-search.js';

/**
 * Mapeamento oficial de teclas padrão do EmulatorJS / RetroArch:
 * Setas (D-Pad), Z/X/A/S (B/A/Y/X ou Cross/Circle/Square/Triangle),
 * Q/E (L1/R1), Enter (Start), V/Shift (Select).
 */
const PAD_KEY_BINDINGS: Array<{
  bit: number;
  ejsIndex: number;
  key: string;
  code: string;
  keyCode: number;
}> = [
  { bit: PAD_BIT.SOUTH, ejsIndex: 0, key: 'z', code: 'KeyZ', keyCode: 90 },
  { bit: PAD_BIT.WEST, ejsIndex: 1, key: 'a', code: 'KeyA', keyCode: 65 },
  { bit: PAD_BIT.SELECT, ejsIndex: 2, key: 'v', code: 'KeyV', keyCode: 86 },
  { bit: PAD_BIT.START, ejsIndex: 3, key: 'Enter', code: 'Enter', keyCode: 13 },
  { bit: PAD_BIT.UP, ejsIndex: 4, key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  { bit: PAD_BIT.DOWN, ejsIndex: 5, key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  { bit: PAD_BIT.LEFT, ejsIndex: 6, key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  { bit: PAD_BIT.RIGHT, ejsIndex: 7, key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  { bit: PAD_BIT.EAST, ejsIndex: 8, key: 'x', code: 'KeyX', keyCode: 88 },
  { bit: PAD_BIT.NORTH, ejsIndex: 9, key: 's', code: 'KeyS', keyCode: 83 },
  { bit: PAD_BIT.L1, ejsIndex: 10, key: 'q', code: 'KeyQ', keyCode: 81 },
  { bit: PAD_BIT.R1, ejsIndex: 11, key: 'e', code: 'KeyE', keyCode: 69 },
  { bit: PAD_BIT.L2, ejsIndex: 12, key: 'r', code: 'KeyR', keyCode: 82 },
  { bit: PAD_BIT.R2, ejsIndex: 13, key: 't', code: 'KeyT', keyCode: 84 },
];

export class RetroPadKeyBridge {
  private prevMask = 0;

  push(state: PadState, target: EventTarget = window): void {
    let mask = state.buttons;
    if (state.lx < -0.4) mask |= PAD_BIT.LEFT;
    if (state.lx > 0.4) mask |= PAD_BIT.RIGHT;
    if (state.ly < -0.4) mask |= PAD_BIT.UP;
    if (state.ly > 0.4) mask |= PAD_BIT.DOWN;

    const changed = mask ^ this.prevMask;
    if (changed === 0) return;

    for (const bind of PAD_KEY_BINDINGS) {
      if ((changed & bind.bit) === 0) continue;
      const isDown = (mask & bind.bit) !== 0;
      const ev = new KeyboardEvent(isDown ? 'keydown' : 'keyup', {
        key: bind.key,
        code: bind.code,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(ev);
    }

    this.prevMask = mask;
  }

  /**
   * Envia os inputs do Celular QR Code diretamente para dentro do iframe do EmulatorJS
   * (usa simulateInput nativo do core + fallback KeyboardEvent).
   */
  pushToIframe(state: PadState, iframe: HTMLIFrameElement | null): void {
    if (!iframe?.contentWindow) return;
    let mask = state.buttons;
    if (state.lx < -0.4) mask |= PAD_BIT.LEFT;
    if (state.lx > 0.4) mask |= PAD_BIT.RIGHT;
    if (state.ly < -0.4) mask |= PAD_BIT.UP;
    if (state.ly > 0.4) mask |= PAD_BIT.DOWN;

    const changed = mask ^ this.prevMask;
    if (changed === 0) return;

    for (const bind of PAD_KEY_BINDINGS) {
      if ((changed & bind.bit) === 0) continue;
      const isDown = (mask & bind.bit) !== 0;
      iframe.contentWindow.postMessage(
        {
          type: 'vgfa-pad-input',
          player: state.slot,
          ejsIndex: bind.ejsIndex,
          key: bind.key,
          code: bind.code,
          keyCode: bind.keyCode,
          down: isDown,
        },
        '*',
      );
    }

    this.prevMask = mask;
  }

  releaseAll(target: EventTarget = window): void {
    if (this.prevMask === 0) return;
    this.push(
      {
        slot: 0,
        buttons: 0,
        lx: 0,
        ly: 0,
        rx: 0,
        ry: 0,
        l2Pressure: 0,
        r2Pressure: 0,
        crossPressure: 0,
        squarePressure: 0,
        seq: 0,
      },
      target,
    );
  }
}

export interface DownloadProgress {
  loadedBytes: number;
  totalBytes: number;
  percent: number;
  fromCache?: boolean;
}

// ==================== Cache Local Rápido de ROMs em IndexedDB (<= 64 MB) ====================
const ROM_CACHE_DB = 'vgfa_rom_cache_v1';
const ROM_CACHE_STORE = 'roms';
const MAX_CACHEABLE_ROM_BYTES = 64 * 1024 * 1024;

function openRomCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(ROM_CACHE_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(ROM_CACHE_STORE)) {
          req.result.createObjectStore(ROM_CACHE_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function getCachedRom(key: string): Promise<Uint8Array | null> {
  const db = await openRomCacheDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ROM_CACHE_STORE, 'readonly');
      const req = tx.objectStore(ROM_CACHE_STORE).get(key);
      req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function putCachedRom(key: string, bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength > MAX_CACHEABLE_ROM_BYTES) return;
  const db = await openRomCacheDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(ROM_CACHE_STORE, 'readwrite');
      tx.objectStore(ROM_CACHE_STORE).put(bytes, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Baixa uma ROM remota via Proxy CORS-Free com barra de progresso real e Cache IndexedDB.
 * Da 2ª vez que o usuário abrir o mesmo jogo, carrega em < 200 ms sem baixar de novo!
 */
export async function fetchRomAsFile(
  url: string,
  filename: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<File> {
  const cached = await getCachedRom(url);
  if (cached && cached.byteLength > 0) {
    onProgress?.({
      loadedBytes: cached.byteLength,
      totalBytes: cached.byteLength,
      percent: 100,
      fromCache: true,
    });
    const copy = new Uint8Array(cached.byteLength);
    copy.set(cached);
    return new File([copy], filename, { type: 'application/octet-stream' });
  }

  const fetchUrl =
    url.startsWith('http://') || url.startsWith('https://')
      ? buildProxyStreamUrl(url)
      : url;

  const res = await globalThis.fetch(fetchUrl, { signal });
  if (!res.ok) {
    let detail = `Erro HTTP ${res.status}`;
    try {
      const errJson = (await res.json()) as { error?: string };
      if (errJson.error) detail = errJson.error;
    } catch {
      // ignora
    }
    throw new Error(detail);
  }

  const totalBytes = Number(res.headers.get('content-length') || 0);
  if (!res.body) {
    const ab = await res.arrayBuffer();
    const bytes = new Uint8Array(ab);
    void putCachedRom(url, bytes);
    onProgress?.({ loadedBytes: bytes.byteLength, totalBytes: bytes.byteLength, percent: 100 });
    return new File([bytes], filename, { type: 'application/octet-stream' });
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loadedBytes += value.byteLength;
      const percent = totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 50;
      onProgress?.({ loadedBytes, totalBytes, percent });
    }
  }

  const merged = new Uint8Array(loadedBytes);
  let pos = 0;
  for (const c of chunks) {
    merged.set(c, pos);
    pos += c.byteLength;
  }
  void putCachedRom(url, merged);
  onProgress?.({ loadedBytes, totalBytes: loadedBytes, percent: 100 });
  return new File([merged], filename, { type: 'application/octet-stream' });
}

export interface RetroWasmSession {
  saveState(): Promise<Uint8Array | null>;
  loadState(bytes: Uint8Array): Promise<void>;
  pause(): void;
  resume(): void;
  exit(): Promise<void>;
}

export async function launchLibretroWasm(params: {
  consoleId: ConsoleId;
  rom: File | string;
  romFilename?: string;
  canvas: HTMLCanvasElement;
  onProgress?: (p: DownloadProgress) => void;
}): Promise<RetroWasmSession> {
  const def = CONSOLE_MAP[params.consoleId];
  if (!def.libretroCore) {
    throw new Error(`O console ${def.name} usa o motor ${def.engineTier}.`);
  }

  let romFile: File;
  if (typeof params.rom === 'string') {
    const fallbackName =
      params.romFilename ||
      decodeURIComponent(params.rom.split('/').pop()?.split('?')[0] || `game${def.extensions[0] || '.rom'}`);
    romFile = await fetchRomAsFile(params.rom, fallbackName, params.onProgress);
  } else {
    romFile = params.rom;
  }

  const { Nostalgist } = await import('nostalgist');
  const instance = await Nostalgist.launch({
    core: def.libretroCore,
    rom: romFile,
    element: params.canvas,
  });

  return {
    async saveState() {
      const { state } = await instance.saveState();
      return new Uint8Array(await state.arrayBuffer());
    },
    async loadState(bytes: Uint8Array) {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      await instance.loadState(new Blob([copy]));
    },
    pause: () => instance.pause(),
    resume: () => instance.resume(),
    async exit() {
      instance.exit();
    },
  };
}

/**
 * Motor Unificado VGFA-FastBoot (EmulatorJS WASM + Ponte Celular QR Code):
 * - Roda liso a 60 FPS no Safari, Chrome, Edge e Firefox sem travar áudio!
 * - Suporta Atari 2600, NES, SNES, Mega Drive, GBA, Nintendo 64, PS1 e PSP!
 * - Recebe os comandos binários do Celular QR Code via postMessage direto na API simulateInput!
 */
export function buildEmulatorJsSrcDoc(params: {
  system: string;
  romBlobUrl: string;
  gameTitle: string;
}): string {
  const safeTitle = JSON.stringify(params.gameTitle);
  const safeUrl = JSON.stringify(params.romBlobUrl);
  const safeSys = JSON.stringify(params.system);
  const needsThreads = params.system === 'psp';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<style>
  html, body, #game { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
  /* Oculta gamepad virtual duplicado do EmulatorJS quando o controle nativo VGFA Mobile estiver ativo */
  .ejs_virtualGamepad_parent { display: none !important; }
</style>
</head>
<body>
  <div id="game"></div>
  <script>
    window.EJS_player = '#game';
    window.EJS_core = ${safeSys};
    window.EJS_gameName = ${safeTitle};
    window.EJS_gameUrl = ${safeUrl};
    window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
    window.EJS_startOnLoaded = true;
    window.EJS_color = '#FFB547';
    window.EJS_backgroundColor = '#07080D';
    window.EJS_threads = ${needsThreads ? 'true' : 'false'};
    window.EJS_language = 'pt-BR';
    window.EJS_Buttons = {
      playPause: true,
      restart: true,
      mute: true,
      settings: true,
      fullscreen: true,
      saveState: true,
      loadState: true,
      screenRecord: false,
      gamepad: true,
      cheat: false,
      volume: true,
      saveSavFiles: true,
      loadSavFiles: true,
      quickSave: true,
      quickLoad: true,
      screenshot: true,
      cacheManager: false
    };

    // Ponte VGFA-Pad: recebe inputs do Celular via QR Code em tempo real!
    window.addEventListener('message', function(ev) {
      var d = ev.data;
      if (!d || d.type !== 'vgfa-pad-input') return;
      try {
        if (window.EJS_emulator && window.EJS_emulator.gameManager && typeof window.EJS_emulator.gameManager.simulateInput === 'function') {
          window.EJS_emulator.gameManager.simulateInput(d.player || 0, d.ejsIndex, d.down ? 1 : 0);
          return;
        }
      } catch (e) {}
      var keyEv = new KeyboardEvent(d.down ? 'keydown' : 'keyup', {
        key: d.key,
        code: d.code,
        keyCode: d.keyCode,
        which: d.keyCode,
        bubbles: true,
        cancelable: true
      });
      window.dispatchEvent(keyEv);
      document.dispatchEvent(keyEv);
    });
  </script>
  <script src="https://cdn.emulatorjs.org/stable/data/loader.js"></script>
</body>
</html>`;
}
