import { PAD_BIT, type ConsoleId, type PadState } from '@vgfa/pad';
import { CONSOLE_MAP } from './consoles.js';

/**
 * Traduz o estado binário do VGFA-Pad (Celular QR Code ou Bluetooth) em eventos de teclado
 * padrão RetroArch/libretro, permitindo controlar cores WASM (NES, SNES, Atari, Mega Drive,
 * GBA, N64, PS1) direto pelo celular com latência mínima!
 */
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
    // Também mapeia analógico esquerdo para D-pad em consoles 8/16-bit
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

export interface RetroWasmSession {
  saveState(): Promise<Uint8Array | null>;
  loadState(bytes: Uint8Array): Promise<void>;
  pause(): void;
  resume(): void;
  exit(): Promise<void>;
}

/**
 * Lança uma ROM real (Atari 2600, NES, SNES, Mega Drive, GBA, N64, PS1)
 * usando RetroArch / libretro WebAssembly via Nostalgist (MIT).
 */
export async function launchLibretroWasm(params: {
  consoleId: ConsoleId;
  rom: File | string;
  canvas: HTMLCanvasElement;
}): Promise<RetroWasmSession> {
  const def = CONSOLE_MAP[params.consoleId];
  if (!def.libretroCore) {
    throw new Error(`O console ${def.name} usa o motor dedicado VGFA-PS2/PSP WebGPU, não libretro.`);
  }

  // Import dinâmico de nostalgist (MIT) no bundle do app web
  const { Nostalgist } = await import('nostalgist');

  const instance = await Nostalgist.launch({
    core: def.libretroCore,
    rom: params.rom,
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
