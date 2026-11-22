import { PAD_BIT, type ConsoleId, type PadState } from '@vgfa/pad';
import { CONSOLE_MAP } from './consoles.js';
import { downloadToLibrary, markPlayed, readLibraryFile, type LibraryMeta } from './rom-library.js';

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

/** Converte o estado do controle numa máscara de botões (opcionalmente analógico → direcional). */
export function padStateToMask(state: PadState, stickToDpad = true): number {
  let mask = state.buttons & 0xffff;
  if (stickToDpad) {
    if (state.lx < -0.4) mask |= PAD_BIT.LEFT;
    if (state.lx > 0.4) mask |= PAD_BIT.RIGHT;
    if (state.ly < -0.4) mask |= PAD_BIT.UP;
    if (state.ly > 0.4) mask |= PAD_BIT.DOWN;
  }
  return mask;
}

/** Consoles cujo analógico vai direto para o core (Mario 64, PSP, PS1 DualShock). */
export const EJS_ANALOG_CONSOLES: ReadonlySet<ConsoleId> = new Set<ConsoleId>(['n64', 'ps1', 'psp']);

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(Math.max(-1, Math.min(1, v)) * 100) / 100;
}

/**
 * Ponte de controle VGFA → EmulatorJS (v0.7).
 *
 * Antes: cada aperto virava UM evento solto; se o emulador ainda não estava pronto
 * (ou o evento se perdia), o botão ficava "morto" até mudar de novo — o famoso
 * "funcionou na tela inicial e depois parou". Agora mandamos o ESTADO COMPLETO dos
 * 4 jogadores, o iframe compara com o que já aplicou e corrige sozinho, e quando
 * o jogo de fato começa tudo é reaplicado.
 */
export class EjsInputBridge {
  private readonly last: string[] = ['', '', '', ''];
  private lastPostAt = 0;

  constructor(private readonly consoleId: ConsoleId) {}

  sync(states: ReadonlyArray<PadState | null | undefined>, iframe: HTMLIFrameElement | null): void {
    const win = iframe?.contentWindow;
    if (!win) return;
    const analog = EJS_ANALOG_CONSOLES.has(this.consoleId);
    const stickToDpad = this.consoleId !== 'n64' && this.consoleId !== 'psp';
    const now = Date.now();
    let changed = false;
    const players: Array<{ mask: number; axes: number[] }> = [];
    for (let p = 0; p < 4; p++) {
      const s = states[p];
      const mask = s ? padStateToMask(s, stickToDpad) : 0;
      const axes = analog && s ? [round2(s.lx), round2(s.ly), round2(s.rx), round2(s.ry)] : [0, 0, 0, 0];
      const key = `${mask}:${axes.join(',')}`;
      if (key !== this.last[p]) {
        this.last[p] = key;
        changed = true;
      }
      players.push({ mask, axes });
    }
    if (!changed && now - this.lastPostAt < 250) return;
    this.lastPostAt = now;
    try {
      win.postMessage({ type: 'vgfa-pad-sync', players }, '*');
    } catch {
      // iframe sendo recriado
    }
  }

  /** Solta tudo (ex.: ao sair do jogo). */
  releaseAll(iframe: HTMLIFrameElement | null): void {
    this.last.fill('');
    this.sync([null, null, null, null], iframe);
  }
}

/** @deprecated use EjsInputBridge (mantido por compatibilidade). */
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

// ==================== Biblioteca local ("Minha Central") ====================
// O cache antigo (vgfa_rom_cache_v1) foi aposentado: rom-library.ts migra sozinho
// o que houver nele na primeira leitura.

/**
 * Entrega uma ROM como File. Se já está na biblioteca do aparelho, abre na hora sem baixar;
 * senão baixa (proxy CORS-Free, com progresso real) e guarda na biblioteca em pedaços.
 * Se não der para guardar (cota cheia, Safari privado), o jogo roda mesmo assim, só na memória.
 */
export async function fetchRomAsFile(
  url: string,
  filename: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
  meta?: LibraryMeta,
): Promise<File> {
  const cached = await readLibraryFile(url);
  if (cached && cached.size > 0) {
    onProgress?.({
      loadedBytes: cached.size,
      totalBytes: cached.size,
      percent: 100,
      fromCache: true,
    });
    void markPlayed(url, meta);
    return cached;
  }

  const file = await downloadToLibrary(url, filename, {
    onProgress,
    signal,
    meta,
    fallbackToMemory: true,
  });
  onProgress?.({ loadedBytes: file.size, totalBytes: file.size, percent: 100 });
  return file;
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

    // Ponte VGFA-Pad v0.7: estado completo por jogador, reaplicado quando o jogo começa.
    (function () {
      // [bit VGFA, índice RetroPad do EmulatorJS]
      var MAP = [[16,0],[64,1],[4096,2],[8192,3],[1,4],[2,5],[4,6],[8,7],[32,8],[128,9],[256,10],[512,11],[1024,12],[2048,13],[16384,14],[32768,15]];
      // eixos: [positivo, negativo] -> LX, LY, RX, RY
      var AXES = [[16,17],[18,19],[20,21],[22,23]];
      function blank() { return { mask: 0, axes: [0, 0, 0, 0] }; }
      var target = [blank(), blank(), blank(), blank()];
      var applied = [blank(), blank(), blank(), blank()];
      var wasReady = false;
      var lastSyncAt = 0;
      function manager() {
        var e = window.EJS_emulator;
        if (!e || !e.gameManager || typeof e.gameManager.simulateInput !== 'function') return null;
        if (e.started === false) return null;
        return e.gameManager;
      }
      function apply() {
        var g = manager();
        if (!g) { wasReady = false; return; }
        if (!wasReady) {
          // Jogo acabou de começar: reaplica tudo do zero
          wasReady = true;
          applied = [blank(), blank(), blank(), blank()];
        }
        for (var p = 0; p < 4; p++) {
          var t = target[p], a = applied[p];
          var diff = (t.mask ^ a.mask) & 0xffff;
          try {
            if (diff) {
              for (var i = 0; i < MAP.length; i++) {
                var bit = MAP[i][0];
                if (diff & bit) g.simulateInput(p, MAP[i][1], (t.mask & bit) ? 1 : 0);
              }
            }
            for (var x = 0; x < 4; x++) {
              var v = t.axes[x] || 0;
              if (v === (a.axes[x] || 0)) continue;
              var pos = AXES[x][0], neg = AXES[x][1];
              if (v > 0) { g.simulateInput(p, pos, Math.round(v * 32767)); g.simulateInput(p, neg, 0); }
              else if (v < 0) { g.simulateInput(p, neg, Math.round(-v * 32767)); g.simulateInput(p, pos, 0); }
              else { g.simulateInput(p, pos, 0); g.simulateInput(p, neg, 0); }
            }
            applied[p] = { mask: t.mask, axes: t.axes.slice() };
          } catch (err) {}
        }
      }
      window.addEventListener('message', function (ev) {
        var d = ev.data;
        if (!d) return;
        if (d.type === 'vgfa-pad-sync' && d.players) {
          for (var p = 0; p < 4; p++) {
            var s = d.players[p];
            target[p] = s ? { mask: (s.mask | 0) & 0xffff, axes: (s.axes || [0, 0, 0, 0]).slice(0, 4) } : blank();
          }
          lastSyncAt = Date.now();
          apply();
        } else if (d.type === 'vgfa-pad-input') {
          // compatibilidade com a ponte antiga (um evento por botão)
          var pl = (d.player | 0) & 3;
          for (var j = 0; j < MAP.length; j++) {
            if (MAP[j][1] === d.ejsIndex) {
              target[pl] = { mask: d.down ? (target[pl].mask | MAP[j][0]) : (target[pl].mask & ~MAP[j][0]), axes: target[pl].axes };
            }
          }
          apply();
        }
      });
      setInterval(function () {
        // A página principal manda o estado a cada 250 ms; se parar, solta os botões
        if (lastSyncAt && Date.now() - lastSyncAt > 2000) {
          target = [blank(), blank(), blank(), blank()];
          lastSyncAt = 0;
        }
        apply();
      }, 100);
    })();
  </script>
  <script src="https://cdn.emulatorjs.org/stable/data/loader.js"></script>
</body>
</html>`;
}
