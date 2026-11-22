import type { PadState } from './types.js';

export const VGFA_PAD_MAGIC = 0x56; // 'V'
export const VGFA_PAD_VERSION = 1;
export const VGFA_PAD_PACKET_BYTES = 16;

function clampAxis(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * Codifica o estado completo de um DualShock 2 (16 botões + 4 eixos + 4 pressões + seq)
 * em exatamente 16 bytes — otimizado para WebRTC DataChannel (< 10 ms de latência).
 */
export function encodePadPacket(state: PadState): Uint8Array {
  const buf = new Uint8Array(VGFA_PAD_PACKET_BYTES);
  const dv = new DataView(buf.buffer);

  buf[0] = VGFA_PAD_MAGIC;
  buf[1] = ((VGFA_PAD_VERSION & 0x0f) << 4) | (state.slot & 0x0f);
  dv.setUint16(2, state.buttons & 0xffff, true);
  dv.setInt8(4, Math.round(clampAxis(state.lx) * 127));
  dv.setInt8(5, Math.round(clampAxis(state.ly) * 127));
  dv.setInt8(6, Math.round(clampAxis(state.rx) * 127));
  dv.setInt8(7, Math.round(clampAxis(state.ry) * 127));
  buf[8] = Math.round(clampUnit(state.l2Pressure) * 255);
  buf[9] = Math.round(clampUnit(state.r2Pressure) * 255);
  buf[10] = Math.round(clampUnit(state.crossPressure) * 255);
  buf[11] = Math.round(clampUnit(state.squarePressure) * 255);
  dv.setUint32(12, state.seq >>> 0, true);

  return buf;
}

export function decodePadPacket(raw: Uint8Array | ArrayBuffer): PadState | null {
  const buf = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  if (buf.byteLength < VGFA_PAD_PACKET_BYTES) return null;
  if (buf[0] !== VGFA_PAD_MAGIC) return null;

  const version = (buf[1] >> 4) & 0x0f;
  if (version !== VGFA_PAD_VERSION) return null;

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    slot: buf[1] & 0x0f,
    buttons: dv.getUint16(2, true),
    lx: dv.getInt8(4) / 127,
    ly: dv.getInt8(5) / 127,
    rx: dv.getInt8(6) / 127,
    ry: dv.getInt8(7) / 127,
    l2Pressure: buf[8] / 255,
    r2Pressure: buf[9] / 255,
    crossPressure: buf[10] / 255,
    squarePressure: buf[11] / 255,
    seq: dv.getUint32(12, true),
  };
}
