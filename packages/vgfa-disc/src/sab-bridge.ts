/**
 * Protocolo lock-free SharedArrayBuffer entre Worker WASM (emulador) e Disc Worker (JS).
 *
 * Inspirado nas medições de latência da Fase 0 (0,015 ms RTT em Atomics.wait/notify),
 * suportando offsets de 64 bits (DVD9 > 4 GB) sem cópia/serialização estruturada.
 */

export const SAB_HEADER_BYTES = 64;
export const SAB_DEFAULT_TRANSFER_BYTES = 1024 * 1024; // 1 MiB

export const SAB_IDX = {
  STATE: 0,
  OP: 1,
  OFFSET_LO: 2,
  OFFSET_HI: 3,
  LENGTH: 4,
  RESULT_BYTES: 5,
  FLAGS: 6,
} as const;

export const SAB_STATE = {
  IDLE: 0,
  PENDING: 1,
  READY: 2,
  ERROR: 3,
} as const;

export const SAB_OP = {
  READ: 1,
  STAT: 2,
  CLOSE: 3,
} as const;

export const SAB_FLAGS = {
  CACHE_HIT: 1 << 0,
  PREFETCH_TRIGGERED: 1 << 1,
} as const;

export interface SabDiscBuffer {
  sab: SharedArrayBuffer;
  ctrl: Int32Array;
  payload: Uint8Array;
  maxTransferBytes: number;
}

export function createSabDiscBuffer(maxTransferBytes = SAB_DEFAULT_TRANSFER_BYTES): SabDiscBuffer {
  const sab = new SharedArrayBuffer(SAB_HEADER_BYTES + maxTransferBytes);
  return attachSabDiscBuffer(sab);
}

export function attachSabDiscBuffer(sab: SharedArrayBuffer): SabDiscBuffer {
  const ctrl = new Int32Array(sab, 0, SAB_HEADER_BYTES / 4);
  const payload = new Uint8Array(sab, SAB_HEADER_BYTES);
  return {
    sab,
    ctrl,
    payload,
    maxTransferBytes: payload.byteLength,
  };
}

export function writeOffset64(ctrl: Int32Array, offset: number): void {
  const lo = offset >>> 0;
  const hi = Math.floor(offset / 0x100000000) >>> 0;
  Atomics.store(ctrl, SAB_IDX.OFFSET_LO, lo | 0);
  Atomics.store(ctrl, SAB_IDX.OFFSET_HI, hi | 0);
}

export function readOffset64(ctrl: Int32Array): number {
  const lo = Atomics.load(ctrl, SAB_IDX.OFFSET_LO) >>> 0;
  const hi = Atomics.load(ctrl, SAB_IDX.OFFSET_HI) >>> 0;
  return hi * 0x100000000 + lo;
}

export interface SabDiscHandler {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/**
 * Lado servidor (roda no Disc Worker ou loop assíncrono) que processa pedidos pendentes
 * sem nunca bloquear a main thread.
 */
export async function processOneSabRequest(
  buf: SabDiscBuffer,
  handler: SabDiscHandler,
): Promise<boolean> {
  const state = Atomics.load(buf.ctrl, SAB_IDX.STATE);
  if (state !== SAB_STATE.PENDING) return false;

  const op = Atomics.load(buf.ctrl, SAB_IDX.OP);
  try {
    if (op === SAB_OP.STAT) {
      writeOffset64(buf.ctrl, handler.size);
      Atomics.store(buf.ctrl, SAB_IDX.RESULT_BYTES, 0);
      Atomics.store(buf.ctrl, SAB_IDX.STATE, SAB_STATE.READY);
      Atomics.notify(buf.ctrl, SAB_IDX.STATE, 1);
      return true;
    }

    if (op === SAB_OP.READ) {
      const offset = readOffset64(buf.ctrl);
      const reqLen = Math.min(Atomics.load(buf.ctrl, SAB_IDX.LENGTH), buf.maxTransferBytes);
      const data = await handler.read(offset, reqLen);
      const copyLen = Math.min(data.byteLength, buf.maxTransferBytes);
      buf.payload.set(data.subarray(0, copyLen), 0);
      Atomics.store(buf.ctrl, SAB_IDX.RESULT_BYTES, copyLen);
      Atomics.store(buf.ctrl, SAB_IDX.STATE, SAB_STATE.READY);
      Atomics.notify(buf.ctrl, SAB_IDX.STATE, 1);
      return true;
    }

    Atomics.store(buf.ctrl, SAB_IDX.RESULT_BYTES, -1);
    Atomics.store(buf.ctrl, SAB_IDX.STATE, SAB_STATE.ERROR);
    Atomics.notify(buf.ctrl, SAB_IDX.STATE, 1);
    return true;
  } catch {
    Atomics.store(buf.ctrl, SAB_IDX.RESULT_BYTES, -2);
    Atomics.store(buf.ctrl, SAB_IDX.STATE, SAB_STATE.ERROR);
    Atomics.notify(buf.ctrl, SAB_IDX.STATE, 1);
    return true;
  }
}

/**
 * Lado cliente (usado por Workers WASM ou testes) para postar pedidos de leitura 64-bit.
 */
export function postSabReadRequest(buf: SabDiscBuffer, offset: number, length: number): void {
  const clamped = Math.min(length, buf.maxTransferBytes);
  Atomics.store(buf.ctrl, SAB_IDX.OP, SAB_OP.READ);
  writeOffset64(buf.ctrl, offset);
  Atomics.store(buf.ctrl, SAB_IDX.LENGTH, clamped);
  Atomics.store(buf.ctrl, SAB_IDX.RESULT_BYTES, 0);
  Atomics.store(buf.ctrl, SAB_IDX.STATE, SAB_STATE.PENDING);
  Atomics.notify(buf.ctrl, SAB_IDX.STATE, 1);
}
