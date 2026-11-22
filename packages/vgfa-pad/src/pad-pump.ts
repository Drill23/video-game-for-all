import { encodePadPacket } from './binary-codec.js';
import type { PadState } from './types.js';

export type PadInput = Omit<PadState, 'slot' | 'seq'>;

export function isPadInputActive(s: PadInput): boolean {
  return (
    s.buttons !== 0 ||
    Math.abs(s.lx) > 0.02 ||
    Math.abs(s.ly) > 0.02 ||
    Math.abs(s.rx) > 0.02 ||
    Math.abs(s.ry) > 0.02 ||
    s.l2Pressure > 0.02 ||
    s.r2Pressure > 0.02
  );
}

export function emptyPadInput(): PadInput {
  return {
    buttons: 0,
    lx: 0,
    ly: 0,
    rx: 0,
    ry: 0,
    l2Pressure: 0,
    r2Pressure: 0,
    crossPressure: 0,
    squarePressure: 0,
  };
}

export interface PadPumpLink {
  /** 'fast' = canal direto (WebRTC/WS), 'slow' = relé pela internet, 'none' = sem saída */
  mode(): 'fast' | 'slow' | 'none';
  sendFast(packet: Uint8Array): void;
  sendSlow(packet: Uint8Array): void;
}

/**
 * Bomba de estado do controle.
 *
 * Por que existe: o canal WebRTC é "sem retransmissão" (para ter latência mínima),
 * então um pacote perdido podia deixar um botão preso ou um aperto sumir — era
 * exatamente o "funcionou no começo e depois parou". Agora o ESTADO COMPLETO é
 * enviado na hora de cada mudança e reenviado continuamente (30x/s com botão
 * apertado, 3x/s parado). O último pacote sempre corrige qualquer perda.
 */
export class PadStatePump {
  private latest: PadInput = emptyPadInput();
  private seq = 0;
  private slot = 0;
  private lastSentAt = 0;
  private trailing: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly link: PadPumpLink) {}

  setSlot(slot: number): void {
    this.slot = slot & 0x0f;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 33);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.trailing) clearTimeout(this.trailing);
    this.trailing = null;
  }

  /** Novo estado vindo da tela de toque: envia já (respeitando o limite do relé). */
  update(state: PadInput): void {
    this.latest = { ...state };
    const mode = this.link.mode();
    if (mode === 'fast') {
      this.flush();
      return;
    }
    if (mode === 'slow') {
      const since = Date.now() - this.lastSentAt;
      if (since >= 45) {
        this.flush();
      } else if (!this.trailing) {
        this.trailing = setTimeout(() => {
          this.trailing = null;
          this.flush();
        }, 45 - since);
      }
    }
  }

  /** Solta tudo (app foi para segundo plano, desconectou etc.). */
  releaseAll(): void {
    this.update(emptyPadInput());
  }

  /** Reenvia o estado atual imediatamente (ex.: canal acabou de abrir). */
  resync(): void {
    this.flush();
  }

  private tick(): void {
    const mode = this.link.mode();
    if (mode === 'none') return;
    const active = isPadInputActive(this.latest);
    const since = Date.now() - this.lastSentAt;
    const interval = mode === 'fast' ? (active ? 33 : 300) : active ? 150 : 1200;
    if (since >= interval) this.flush();
  }

  private flush(): void {
    const mode = this.link.mode();
    if (mode === 'none') return;
    this.seq = (this.seq + 1) >>> 0;
    const packet = encodePadPacket({ ...this.latest, slot: this.slot, seq: this.seq });
    this.lastSentAt = Date.now();
    if (mode === 'fast') this.link.sendFast(packet);
    else this.link.sendSlow(packet);
  }
}
