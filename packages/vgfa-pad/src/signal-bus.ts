/**
 * VGFA Link — barramento de sinalização 100% sem servidor próprio (v0.7).
 *
 * Fala MQTT 3.1.1 sobre WebSocket com brokers públicos e gratuitos (EMQX, HiveMQ,
 * Mosquitto) ao mesmo tempo. Cada sala é um tópico; as mensagens são JSON pequenas
 * (entrada, oferta/resposta WebRTC, e — se o WebRTC falhar — o próprio controle).
 * Basta UM broker responder para o pareamento funcionar, por isso usamos vários.
 */

export const DEFAULT_SIGNAL_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker-cn.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

const TOPIC_NAMESPACE = 'vgfa-link-7c1e/v7';
const KEEPALIVE_SECONDS = 25;

export interface BusMessage {
  /** tipo da mensagem */
  k: string;
  /** id de quem enviou */
  f: string;
  /** id do destinatário (vazio = todos) */
  t?: string;
  /** id único da mensagem (deduplicação entre brokers) */
  m?: string;
  [key: string]: unknown;
}

export type BusStatus = 'connecting' | 'online' | 'offline';

const enc = new TextEncoder();
const dec = new TextDecoder();

function utf8(str: string): Uint8Array {
  return enc.encode(str);
}

function mqttString(str: string): Uint8Array {
  const bytes = utf8(str);
  const out = new Uint8Array(bytes.length + 2);
  out[0] = (bytes.length >> 8) & 0xff;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function encodeRemainingLength(len: number): number[] {
  const out: number[] = [];
  do {
    let byte = len % 128;
    len = Math.floor(len / 128);
    if (len > 0) byte |= 0x80;
    out.push(byte);
  } while (len > 0);
  return out;
}

function packet(header: number, ...parts: Uint8Array[]): Uint8Array {
  const bodyLen = parts.reduce((n, p) => n + p.length, 0);
  const rl = encodeRemainingLength(bodyLen);
  const out = new Uint8Array(1 + rl.length + bodyLen);
  out[0] = header;
  out.set(rl, 1);
  let off = 1 + rl.length;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function randomId(len = 12): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  const rnd = new Uint8Array(len);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(rnd);
  else for (let i = 0; i < len; i++) rnd[i] = Math.floor(Math.random() * 256);
  for (let i = 0; i < len; i++) s += alphabet[rnd[i] % alphabet.length];
  return s;
}

export function randomBusId(prefix = ''): string {
  return `${prefix}${randomId(10)}`;
}

/** Conexão MQTT mínima (QoS 0) sobre um WebSocket. */
class MqttWsConnection {
  private ws: WebSocket | null = null;
  private buffer = new Uint8Array(0);
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private packetId = 1;
  private retries = 0;
  private closed = false;
  ready = false;

  constructor(
    readonly url: string,
    private readonly topic: string,
    private readonly onPayload: (text: string) => void,
    private readonly onReadyChange: () => void,
  ) {}

  open(): void {
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url, ['mqtt']);
    } catch {
      this.scheduleRetry();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.buffer = new Uint8Array(0);

    const timeout = setTimeout(() => {
      if (!this.ready) {
        try {
          ws.close();
        } catch {}
      }
    }, 8000);

    ws.onopen = () => {
      const clientId = `vgfa${randomId(14)}`;
      const variable = new Uint8Array([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, KEEPALIVE_SECONDS]);
      this.sendRaw(packet(0x10, variable, mqttString(clientId)));
    };

    ws.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      const chunk = new Uint8Array(ev.data);
      const merged = new Uint8Array(this.buffer.length + chunk.length);
      merged.set(this.buffer, 0);
      merged.set(chunk, this.buffer.length);
      this.buffer = merged;
      this.drain();
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      this.setReady(false);
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.ws = null;
      this.scheduleRetry();
    };

    ws.onerror = () => {
      // onclose cuida da reconexão
    };
  }

  private scheduleRetry(): void {
    if (this.closed) return;
    this.retries++;
    const delay = Math.min(15000, 600 * 2 ** Math.min(this.retries, 5));
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private setReady(v: boolean): void {
    if (this.ready === v) return;
    this.ready = v;
    this.onReadyChange();
  }

  private drain(): void {
    for (;;) {
      const buf = this.buffer;
      if (buf.length < 2) return;
      let mult = 1;
      let len = 0;
      let i = 1;
      let byte = 0;
      do {
        if (i >= buf.length) return;
        byte = buf[i++];
        len += (byte & 0x7f) * mult;
        mult *= 128;
      } while (byte & 0x80);
      if (buf.length < i + len) return;
      const type = buf[0] >> 4;
      const body = buf.subarray(i, i + len);
      this.handlePacket(type, buf[0], body);
      this.buffer = buf.slice(i + len);
    }
  }

  private handlePacket(type: number, header: number, body: Uint8Array): void {
    switch (type) {
      case 2: {
        // CONNACK
        if (body[1] !== 0) {
          try {
            this.ws?.close();
          } catch {}
          return;
        }
        this.retries = 0;
        const id = this.packetId++ & 0xffff;
        this.sendRaw(packet(0x82, new Uint8Array([id >> 8, id & 0xff]), mqttString(this.topic), new Uint8Array([0])));
        break;
      }
      case 9: {
        // SUBACK
        this.setReady(true);
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.sendRaw(new Uint8Array([0xc0, 0x00])), (KEEPALIVE_SECONDS - 5) * 1000);
        break;
      }
      case 3: {
        // PUBLISH
        const qos = (header >> 1) & 0x03;
        const topicLen = (body[0] << 8) | body[1];
        let off = 2 + topicLen;
        if (qos > 0) off += 2;
        try {
          this.onPayload(dec.decode(body.subarray(off)));
        } catch {}
        break;
      }
      default:
        break;
    }
  }

  private sendRaw(bytes: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(bytes);
      } catch {}
    }
  }

  publish(text: string): boolean {
    if (!this.ready) return false;
    this.sendRaw(packet(0x30, mqttString(this.topic), utf8(text)));
    return true;
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(new Uint8Array([0xe0, 0x00]));
        ws.close();
      } catch {}
    }
  }
}

/**
 * Sala de sinalização: publica/assina mensagens JSON num tópico em vários brokers.
 * Mensagens repetidas (chegando por mais de um broker) são descartadas pelo campo `m`.
 */
export class SignalBus {
  private readonly conns: MqttWsConnection[] = [];
  private readonly seen = new Map<string, number>();
  private readonly pending: string[] = [];
  private status: BusStatus = 'connecting';
  private disposed = false;
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly room: string,
    readonly selfId: string,
    private readonly onMessage: (msg: BusMessage) => void,
    private readonly onStatus?: (status: BusStatus, brokers: number) => void,
    brokers: string[] = DEFAULT_SIGNAL_BROKERS,
  ) {
    const topic = `${TOPIC_NAMESPACE}/${room.trim().toUpperCase()}`;
    for (const url of brokers) {
      this.conns.push(
        new MqttWsConnection(
          url,
          topic,
          (text) => this.handleText(text),
          () => this.refreshStatus(),
        ),
      );
    }
  }

  start(): void {
    if (typeof WebSocket === 'undefined') {
      this.status = 'offline';
      this.onStatus?.('offline', 0);
      return;
    }
    for (const c of this.conns) c.open();
    this.gcTimer = setInterval(() => {
      const cutoff = Date.now() - 60_000;
      for (const [id, ts] of this.seen) if (ts < cutoff) this.seen.delete(id);
    }, 30_000);
    // Se nenhum broker responder em 9 s, avisa (mas continua tentando)
    setTimeout(() => {
      if (!this.disposed && this.onlineCount() === 0) {
        this.status = 'offline';
        this.onStatus?.('offline', 0);
      }
    }, 9000);
  }

  onlineCount(): number {
    return this.conns.filter((c) => c.ready).length;
  }

  isOnline(): boolean {
    return this.onlineCount() > 0;
  }

  private refreshStatus(): void {
    const n = this.onlineCount();
    const next: BusStatus = n > 0 ? 'online' : this.status === 'online' ? 'connecting' : this.status;
    if (n > 0 && this.pending.length) {
      const queued = this.pending.splice(0);
      for (const text of queued) this.publishText(text);
    }
    this.status = next;
    this.onStatus?.(next, n);
  }

  private handleText(text: string): void {
    if (this.disposed) return;
    let msg: BusMessage;
    try {
      msg = JSON.parse(text) as BusMessage;
    } catch {
      return;
    }
    if (!msg || typeof msg.k !== 'string' || typeof msg.f !== 'string') return;
    if (msg.f === this.selfId) return;
    if (msg.t && msg.t !== this.selfId) return;
    if (msg.m) {
      if (this.seen.has(msg.m)) return;
      this.seen.set(msg.m, Date.now());
    }
    this.onMessage(msg);
  }

  private publishText(text: string): boolean {
    let sent = false;
    for (const c of this.conns) if (c.publish(text)) sent = true;
    return sent;
  }

  /**
   * Envia para a sala. Se nenhum broker estiver pronto e `queue` for true,
   * guarda e envia assim que algum conectar (útil para entrar/ofertas).
   */
  send(msg: Omit<BusMessage, 'f' | 'm'> & { m?: string }, queue = true): boolean {
    if (this.disposed) return false;
    const full: BusMessage = { ...msg, f: this.selfId, m: msg.m ?? randomId(10) } as BusMessage;
    const text = JSON.stringify(full);
    const sent = this.publishText(text);
    if (!sent && queue) {
      this.pending.push(text);
      if (this.pending.length > 20) this.pending.shift();
    }
    return sent;
  }

  dispose(): void {
    this.disposed = true;
    if (this.gcTimer) clearInterval(this.gcTimer);
    for (const c of this.conns) c.close();
  }
}

/** Converte os 16 bytes do controle em base64 curto para trafegar pelo barramento. */
export function packetToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return typeof btoa === 'function' ? btoa(s) : '';
}

export function base64ToPacket(b64: string): Uint8Array | null {
  try {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
