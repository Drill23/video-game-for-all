import {
  PAD_BIT,
  createEmptyPadState,
  type ConnectedPadInfo,
  type PadState,
  type RumbleCommand,
} from './types.js';

const DEADZONE = 0.14;

function applyDeadzone(v: number): number {
  if (Math.abs(v) < DEADZONE) return 0;
  return (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);
}

/**
 * Lê controles Bluetooth/USB reais via HTML5 Gamepad API (DualShock 4, DualSense,
 * Xbox Series/One, 8BitDo, Switch Pro e genéricos).
 */
export class BluetoothGamepadAdapter {
  private seq = 0;

  listConnected(): ConnectedPadInfo[] {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return [];
    }
    const pads = navigator.getGamepads();
    const result: ConnectedPadInfo[] = [];
    for (let i = 0; i < pads.length; i++) {
      const gp = pads[i];
      if (!gp || !gp.connected) continue;
      result.push({
        id: `bt-${gp.index}`,
        slot: Math.min(3, gp.index),
        kind: 'bluetooth',
        label: gp.id.replace(/\s*\(STANDARD GAMEPAD.*?\)/i, '').trim() || `Bluetooth Pad ${gp.index + 1}`,
        connectedAt: Math.round(gp.timestamp || Date.now()),
      });
    }
    return result;
  }

  pollAll(): Map<number, PadState> {
    const out = new Map<number, PadState>();
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return out;
    }
    const pads = navigator.getGamepads();
    this.seq++;

    for (let i = 0; i < pads.length && i < 4; i++) {
      const gp = pads[i];
      if (!gp || !gp.connected) continue;

      const s = createEmptyPadState(i);
      s.seq = this.seq;
      const b = gp.buttons;
      let mask = 0;

      if (b[0]?.pressed) mask |= PAD_BIT.SOUTH;
      if (b[1]?.pressed) mask |= PAD_BIT.EAST;
      if (b[2]?.pressed) mask |= PAD_BIT.WEST;
      if (b[3]?.pressed) mask |= PAD_BIT.NORTH;
      if (b[4]?.pressed) mask |= PAD_BIT.L1;
      if (b[5]?.pressed) mask |= PAD_BIT.R1;
      if (b[6]?.pressed || (b[6]?.value ?? 0) > 0.15) mask |= PAD_BIT.L2;
      if (b[7]?.pressed || (b[7]?.value ?? 0) > 0.15) mask |= PAD_BIT.R2;
      if (b[8]?.pressed) mask |= PAD_BIT.SELECT;
      if (b[9]?.pressed) mask |= PAD_BIT.START;
      if (b[10]?.pressed) mask |= PAD_BIT.L3;
      if (b[11]?.pressed) mask |= PAD_BIT.R3;
      if (b[12]?.pressed) mask |= PAD_BIT.UP;
      if (b[13]?.pressed) mask |= PAD_BIT.DOWN;
      if (b[14]?.pressed) mask |= PAD_BIT.LEFT;
      if (b[15]?.pressed) mask |= PAD_BIT.RIGHT;

      s.buttons = mask;
      s.lx = applyDeadzone(gp.axes[0] ?? 0);
      s.ly = applyDeadzone(gp.axes[1] ?? 0);
      s.rx = applyDeadzone(gp.axes[2] ?? 0);
      s.ry = applyDeadzone(gp.axes[3] ?? 0);
      s.l2Pressure = b[6]?.value ?? (mask & PAD_BIT.L2 ? 1 : 0);
      s.r2Pressure = b[7]?.value ?? (mask & PAD_BIT.R2 ? 1 : 0);
      s.crossPressure = b[0]?.value ?? (mask & PAD_BIT.SOUTH ? 1 : 0);
      s.squarePressure = b[2]?.value ?? (mask & PAD_BIT.WEST ? 1 : 0);

      out.set(i, s);
    }

    return out;
  }

  rumble(cmd: RumbleCommand): void {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
    const gp = navigator.getGamepads()[cmd.slot] as (Gamepad & {
      vibrationActuator?: {
        playEffect?: (
          type: string,
          params: { duration: number; strongMagnitude: number; weakMagnitude: number },
        ) => Promise<void>;
      };
    }) | null;
    if (!gp?.vibrationActuator?.playEffect) return;
    void gp.vibrationActuator
      .playEffect('dual-rumble', {
        duration: cmd.durationMs,
        strongMagnitude: Math.max(0, Math.min(1, cmd.strong)),
        weakMagnitude: Math.max(0, Math.min(1, cmd.weak)),
      })
      .catch(() => {});
  }
}

/**
 * Mapeamento de teclado padrão (permite testar e jogar imediatamente sem controle).
 */
export const DEFAULT_KEYBOARD_MAP: Record<string, number> = {
  ArrowUp: PAD_BIT.UP,
  ArrowDown: PAD_BIT.DOWN,
  ArrowLeft: PAD_BIT.LEFT,
  ArrowRight: PAD_BIT.RIGHT,
  KeyW: PAD_BIT.UP,
  KeyS: PAD_BIT.DOWN,
  KeyA: PAD_BIT.LEFT,
  KeyD: PAD_BIT.RIGHT,
  KeyZ: PAD_BIT.SOUTH,
  Space: PAD_BIT.SOUTH,
  KeyX: PAD_BIT.EAST,
  KeyC: PAD_BIT.WEST,
  KeyV: PAD_BIT.NORTH,
  KeyQ: PAD_BIT.L1,
  KeyE: PAD_BIT.R1,
  Digit1: PAD_BIT.L2,
  Digit2: PAD_BIT.R2,
  ShiftRight: PAD_BIT.SELECT,
  Backspace: PAD_BIT.SELECT,
  Enter: PAD_BIT.START,
};
