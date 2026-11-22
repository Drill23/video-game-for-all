import { PAD_BIT, type ConsoleId, type PadState } from '@vgfa/pad';
import { CONSOLE_MAP } from './consoles.js';
import { buildProxyStreamUrl } from './archive-search.js';

const RETROARCH_KEY_BINDINGS: Array<{ bit: number; key: string; code: string; keyCode: number }> = [
  { bit: PAD_BIT.UP, key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  { bit: PAD_BIT.DOWN, key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  { bit: PAD_BIT.LEFT, key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  { bit: PAD_BIT.RIGHT, key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  { bit: PAD_BIT.SOUTH, key: 'z', code: 'KeyZ', keyCode: 90 },
  { bit: PAD_BIT.EAST, key: 'x', code: 'KeyX', keyCode: 88 },
  { bit: PAD_BIT.WEST, key: 'a', code: 'KeyA', keyCode: 65 },
  { bit: PAD_BIT.NORTH, key: 's', code: 'KeyS', keyCode: 83 },
  { bit: PAD_BIT.L1, key: 'q', code: 'KeyQ', keyCode: 81 },
  { bit: PAD_BIT.R1, key: 'w', code: 'KeyW', keyCode: 87 },
  { bit: PAD_BIT.START, key: 'Enter', code: 'Enter', keyCode: 13 },
  { bit: PAD_BIT.SELECT, key: 'Shift', code: 'ShiftRight', keyCode: 16 },
];

export class RetroPadKeyBridge {
  private prevMask = 0;

  push(state: PadState, target: EventTarget = window): void {
    let mask = state.buttons;
    if (state.lx < -0.45) mask |= PAD_BIT.LEFT;
    if (state.lx > 0.45) mask |= PAD_BIT.RIGHT;
    if (state.ly < -0.45) mask |= PAD_BIT.UP;
    if (state.ly > 0.45) mask |= PAD_BIT.DOWN;

    const changed = mask ^ this.prevMask;
    if (changed === 0) return;

    for (const bind of RETROARCH_KEY_BINDINGS) {
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
}

/**
 * Baixa uma ROM remota através do nosso proxy CORS-free (/api/proxy/stream) com barra de progresso real
 * e devolve um File pronto para emuladores WASM sem erro de CORS ou COEP!
 */
export async function fetchRomAsFile(
  url: string,
  filename: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<File> {
  const fetchUrl =
    url.startsWith('http://') || url.startsWith('https://')
      ? buildProxyStreamUrl(url)
      : url;

  const res = await fetch(fetchUrl, { signal });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
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
    onProgress?.({ loadedBytes: ab.byteLength, totalBytes: ab.byteLength, percent: 100 });
    return new File([ab], filename, { type: 'application/octet-stream' });
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

/**
 * Lança uma ROM real (NES, SNES, Mega Drive, GBA, PS1) usando RetroArch / libretro WebAssembly
 * via Nostalgist (MIT) com cores verificados HTTP 200.
 */
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
 * Gera um documento HTML isolado para o EmulatorJS CDN (cores HTTP 200 verificados:
 * Atari 2600 stella2014, Nintendo 64 mupen64plus_next e PSP ppsspp-thread-wasm!).
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
  </script>
  <script src="https://cdn.emulatorjs.org/stable/data/loader.js"></script>
</body>
</html>`;
}
