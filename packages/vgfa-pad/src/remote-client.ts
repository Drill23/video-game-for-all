import { PadStatePump, type PadInput } from './pad-pump.js';
import { SignalBus, packetToBase64, type BusMessage } from './signal-bus.js';
import { createRtcPeer, waitIceComplete } from './serverless-rtc.js';
import type { ConsoleId, RumbleCommand } from './types.js';

export type PadTransport = 'webrtc' | 'ws' | 'relay';

export interface RemoteClientEvents {
  onConnected?: (info: { slot: number; consoleId: ConsoleId; gameTitle: string }) => void;
  onConsoleChanged?: (consoleId: ConsoleId, gameTitle: string) => void;
  onTransportChanged?: (transport: PadTransport) => void;
  onRumble?: (cmd: RumbleCommand) => void;
  onDisconnected?: (reason?: string) => void;
  /** Mensagens de progresso para a tela do celular ("Procurando a tela…", "Reconectando…") */
  onStatus?: (text: string) => void;
}

function persistentClientId(): string {
  const make = () => `p${Math.random().toString(36).slice(2, 12)}`;
  try {
    const key = 'vgfa:pad-client-id';
    const existing = localStorage.getItem(key);
    if (existing && /^p[a-z0-9]{6,}$/.test(existing)) return existing;
    const id = make();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return make();
  }
}

/**
 * Cliente do Controle Remoto VGFA (roda no navegador do celular após escanear o QR Code).
 *
 * - Com servidor próprio (/ws em localhost/LAN): usa o WebSocket + WebRTC como antes.
 * - Sem servidor (GitHub Pages): pareia pelo VGFA Link (brokers MQTT públicos),
 *   os botões já funcionam pelo relé em ~2 s e o canal sobe sozinho para WebRTC direto.
 * - Mesmo id do aparelho entre recargas: volta para o MESMO jogador (P1 continua P1).
 */
export class RemotePadClient {
  private ws: WebSocket | null = null;
  private bus: SignalBus | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private hostId: string | null = null;
  private slot = 0;
  private disposed = false;
  private wsOpenedOnce = false;
  private welcomed = false;
  private everWelcomed = false;
  private transport: PadTransport | null = null;
  private readonly clientId = persistentClientId();
  private joinTimer: ReturnType<typeof setInterval> | null = null;
  private joinStartedAt = 0;
  private rtcRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private rtcAttempts = 0;
  private lastHostSeenAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private readonly pump: PadStatePump;
  private readonly onVisibility = () => this.handleVisibility();

  constructor(
    private readonly signalingUrl: string,
    private readonly roomCode: string,
    private readonly deviceLabel = 'Smartphone VGFA',
    private readonly events: RemoteClientEvents = {},
  ) {
    this.pump = new PadStatePump({
      mode: () => {
        if (this.dc?.readyState === 'open') return 'fast';
        if (this.ws?.readyState === WebSocket.OPEN && this.wsOpenedOnce) return 'fast';
        if (this.bus && this.hostId && this.welcomed) return 'slow';
        return 'none';
      },
      sendFast: (packet) => {
        if (this.dc?.readyState === 'open') {
          try {
            this.dc.send(packet.buffer as ArrayBuffer);
            return;
          } catch {}
        }
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(packet.buffer as ArrayBuffer);
      },
      sendSlow: (packet) => {
        if (this.bus && this.hostId) {
          this.bus.send({ k: 'pad', t: this.hostId, p: packetToBase64(packet) }, false);
        }
      },
    });
  }

  getSlot(): number {
    return this.slot;
  }

  getTransport(): PadTransport | null {
    return this.transport;
  }

  connect(): void {
    if (this.disposed) return;
    this.pump.start();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }

    if (this.signalingUrl === 'serverless' || this.signalingUrl.startsWith('serverless://')) {
      this.connectLink();
      return;
    }

    const ws = new WebSocket(this.signalingUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.wsOpenedOnce = true;
      ws.send(
        JSON.stringify({
          type: 'pad:join',
          roomCode: this.roomCode.trim().toUpperCase(),
          label: this.deviceLabel,
        }),
      );
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data);
        this.handleWsMessage(msg);
      } catch {
        // ignora
      }
    };

    ws.onclose = () => {
      if (this.bus || this.disposed) return;
      if (!this.wsOpenedOnce) {
        this.ws = null;
        this.connectLink();
        return;
      }
      this.events.onDisconnected?.('Conexão encerrada');
    };

    ws.onerror = () => {
      if (!this.wsOpenedOnce && !this.disposed && !this.bus) {
        try {
          ws.close();
        } catch {}
      }
    };
  }

  // ---------------------------------------------------------------- VGFA Link (sem servidor)

  private connectLink(): void {
    if (this.disposed || this.bus) return;
    this.events.onStatus?.('Procurando a tela do jogo…');
    const bus = new SignalBus(
      this.roomCode,
      this.clientId,
      (msg) => this.handleBusMessage(msg),
      (status, n) => {
        if (status === 'offline' && !this.welcomed) {
          this.events.onStatus?.('Sem acesso ao canal de pareamento. Verifique a internet do celular.');
        } else if (status === 'online' && !this.welcomed) {
          this.events.onStatus?.(`Procurando a tela do jogo… (${n} canal${n > 1 ? 'is' : ''})`);
        }
      },
    );
    this.bus = bus;
    bus.start();
    this.startJoinLoop();
    this.watchdog = setInterval(() => this.checkHostAlive(), 2000);
  }

  private startJoinLoop(): void {
    if (this.joinTimer) clearInterval(this.joinTimer);
    this.joinStartedAt = Date.now();
    let lastSent = 0;
    const sendJoin = () => {
      if (this.disposed || this.welcomed) return;
      const elapsed = Date.now() - this.joinStartedAt;
      // Já esteve conectado: espera a tela do jogo voltar sem desistir (mais devagar depois de 30 s)
      const interval = this.everWelcomed && elapsed > 30_000 ? 4000 : 1500;
      if (Date.now() - lastSent < interval - 50) return;
      lastSent = Date.now();
      this.bus?.send({ k: 'join', label: this.deviceLabel }, false);
      if (!this.everWelcomed && elapsed > 45_000) {
        if (this.joinTimer) clearInterval(this.joinTimer);
        this.joinTimer = null;
        this.events.onDisconnected?.(
          'Não encontrei a tela do jogo. Confira se o jogo está aberto e se o código da sala está certo.',
        );
      }
    };
    sendJoin();
    this.joinTimer = setInterval(sendJoin, 500);
  }

  private checkHostAlive(): void {
    if (!this.welcomed || this.disposed) return;
    const dcOpen = this.dc?.readyState === 'open';
    if (dcOpen) return;
    if (Date.now() - this.lastHostSeenAt > 12_000) {
      // Tela do jogo sumiu (recarregou/fechou): volta a procurar sem perder o lugar
      this.welcomed = false;
      this.hostId = null;
      this.setTransport(null);
      this.pump.releaseAll();
      this.events.onStatus?.('Aguardando a tela do jogo… (abra o jogo de novo na TV/PC)');
      this.startJoinLoop();
    }
  }

  private handleBusMessage(msg: BusMessage): void {
    if (this.disposed) return;
    if (this.hostId && msg.f === this.hostId) this.lastHostSeenAt = Date.now();

    switch (msg.k) {
      case 'welcome': {
        if (msg.t !== this.clientId) return;
        const firstWelcome = !this.welcomed || this.hostId !== msg.f;
        this.hostId = msg.f;
        this.lastHostSeenAt = Date.now();
        this.slot = Number(msg.slot ?? 0) & 0x0f;
        this.pump.setSlot(this.slot);
        this.welcomed = true;
        this.everWelcomed = true;
        if (this.joinTimer) clearInterval(this.joinTimer);
        this.joinTimer = null;
        if (this.dc?.readyState !== 'open') this.setTransport('relay');
        this.events.onConnected?.({
          slot: this.slot,
          consoleId: (msg.consoleId as ConsoleId) || 'ps2',
          gameTitle: String(msg.gameTitle || 'VGFA'),
        });
        this.pump.resync();
        if (firstWelcome) {
          this.rtcAttempts = 0;
          void this.startRtc();
        }
        break;
      }
      case 'answer': {
        if (!this.pc || msg.oid !== this.currentOfferId) return;
        void this.pc
          .setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit))
          .catch(() => {});
        break;
      }
      case 'console': {
        this.events.onConsoleChanged?.((msg.consoleId as ConsoleId) || 'ps2', String(msg.gameTitle || 'VGFA'));
        break;
      }
      case 'rumble': {
        if (msg.slot !== undefined && Number(msg.slot) !== this.slot) return;
        this.triggerHaptics(msg as unknown as RumbleCommand);
        break;
      }
      case 'host-bye': {
        this.lastHostSeenAt = 0;
        this.checkHostAlive();
        break;
      }
      default:
        break;
    }
  }

  private currentOfferId = '';

  private async startRtc(): Promise<void> {
    if (this.disposed || !this.bus || !this.hostId || typeof RTCPeerConnection === 'undefined') return;
    if (this.rtcRetryTimer) clearTimeout(this.rtcRetryTimer);
    this.rtcAttempts++;
    this.closeRtc();

    const pc = createRtcPeer();
    this.pc = pc;
    const dc = pc.createDataChannel('vgfa-pad', { ordered: false, maxRetransmits: 0 });
    dc.binaryType = 'arraybuffer';
    this.dc = dc;
    const offerId = `o${Math.random().toString(36).slice(2, 10)}`;
    this.currentOfferId = offerId;

    dc.onopen = () => {
      if (this.dc !== dc) return;
      this.setTransport('webrtc');
      try {
        dc.send(JSON.stringify({ type: 'hello', label: this.deviceLabel, cid: this.clientId }));
      } catch {}
      this.pump.resync();
    };
    dc.onmessage = (m) => {
      if (typeof m.data !== 'string') return;
      try {
        const payload = JSON.parse(m.data);
        this.lastHostSeenAt = Date.now();
        if (payload.type === 'console') {
          this.events.onConsoleChanged?.(payload.consoleId, payload.gameTitle || 'VGFA');
        } else if (payload.type === 'rumble') {
          this.triggerHaptics(payload);
        } else if (payload.type === 'welcome' && payload.slot !== undefined) {
          this.slot = Number(payload.slot) & 0x0f;
          this.pump.setSlot(this.slot);
        }
      } catch {}
    };
    dc.onclose = () => {
      if (this.dc !== dc || this.disposed) return;
      this.setTransport(this.welcomed ? 'relay' : null);
      this.scheduleRtcRetry(2500);
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'failed') {
        this.setTransport(this.welcomed ? 'relay' : null);
        this.scheduleRtcRetry(4000);
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceComplete(pc, 1500);
      if (this.disposed || this.pc !== pc || !pc.localDescription || !this.hostId) return;
      this.bus.send({
        k: 'offer',
        t: this.hostId,
        oid: offerId,
        sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
      });
      // Se o WebRTC direto não abrir, segue pelo relé e tenta de novo mais tarde
      this.rtcRetryTimer = setTimeout(() => {
        if (this.pc === pc && this.dc?.readyState !== 'open') this.scheduleRtcRetry(0);
      }, 9000);
    } catch {
      this.scheduleRtcRetry(5000);
    }
  }

  private scheduleRtcRetry(delay: number): void {
    if (this.disposed || !this.welcomed) return;
    if (this.rtcRetryTimer) clearTimeout(this.rtcRetryTimer);
    if (this.rtcAttempts >= 4) return; // relé continua funcionando
    this.rtcRetryTimer = setTimeout(() => void this.startRtc(), delay);
  }

  private closeRtc(): void {
    const dc = this.dc;
    const pc = this.pc;
    this.dc = null;
    this.pc = null;
    try {
      dc?.close();
    } catch {}
    try {
      pc?.close();
    } catch {}
  }

  private setTransport(t: PadTransport | null): void {
    if (this.transport === t) return;
    this.transport = t;
    if (t) this.events.onTransportChanged?.(t);
  }

  private handleVisibility(): void {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') {
      // Celular bloqueou/trocou de app: solta todos os botões na hora
      this.pump.releaseAll();
    } else if (this.welcomed && this.dc?.readyState !== 'open' && this.bus) {
      this.rtcAttempts = 0;
      this.scheduleRtcRetry(300);
    } else if (this.bus && !this.welcomed) {
      this.startJoinLoop();
    }
  }

  // ---------------------------------------------------------------- Envio de estado

  sendState(state: PadInput): void {
    this.pump.update(state);
  }

  // ---------------------------------------------------------------- Servidor próprio (/ws)

  private handleWsMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'room:joined': {
        this.slot = Number(msg.slot ?? 0);
        this.pump.setSlot(this.slot);
        const consoleId = (msg.consoleId as ConsoleId) || 'ps2';
        const gameTitle = String(msg.gameTitle || 'VGFA');
        this.setTransport('ws');
        this.events.onConnected?.({ slot: this.slot, consoleId, gameTitle });
        this.pump.resync();
        break;
      }
      case 'room:error': {
        this.events.onDisconnected?.(String(msg.message || 'Sala não encontrada'));
        break;
      }
      case 'host:console': {
        const consoleId = (msg.consoleId as ConsoleId) || 'ps2';
        this.events.onConsoleChanged?.(consoleId, String(msg.gameTitle || 'VGFA'));
        break;
      }
      case 'host:rumble': {
        this.triggerHaptics(msg as unknown as RumbleCommand);
        break;
      }
      case 'rtc:offer': {
        void this.handleWsRtcOffer(msg.sdp as RTCSessionDescriptionInit);
        break;
      }
      case 'rtc:ice': {
        if (this.pc && msg.candidate) {
          void this.pc.addIceCandidate(msg.candidate as RTCIceCandidateInit).catch(() => {});
        }
        break;
      }
    }
  }

  private async handleWsRtcOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (typeof RTCPeerConnection === 'undefined') return;
    try {
      this.closeRtc();
      const pc = createRtcPeer();
      this.pc = pc;

      pc.ondatachannel = (ev) => {
        const dc = ev.channel;
        dc.binaryType = 'arraybuffer';
        this.dc = dc;
        dc.onopen = () => {
          this.setTransport('webrtc');
          this.pump.resync();
        };
        dc.onclose = () => this.setTransport('ws');
        dc.onmessage = (m) => {
          if (typeof m.data !== 'string') return;
          try {
            const payload = JSON.parse(m.data);
            if (payload.type === 'console') {
              this.events.onConsoleChanged?.(payload.consoleId, payload.gameTitle || 'VGFA');
            } else if (payload.type === 'rumble') {
              this.triggerHaptics(payload);
            }
          } catch {
            // ignora
          }
        };
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'rtc:ice', candidate: ev.candidate }));
        }
      };

      await pc.setRemoteDescription(sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'rtc:answer', sdp: answer }));
      }
    } catch {
      // Fallback WebSocket já ativo
    }
  }

  private triggerHaptics(cmd: RumbleCommand): void {
    this.events.onRumble?.(cmd);
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      const ms = Math.max(15, Math.min(400, Math.round(cmd.durationMs || 60)));
      try {
        navigator.vibrate(ms);
      } catch {}
    }
  }

  dispose(): void {
    if (this.disposed) return;
    try {
      this.pump.releaseAll();
    } catch {}
    this.disposed = true;
    this.pump.stop();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    if (this.joinTimer) clearInterval(this.joinTimer);
    if (this.rtcRetryTimer) clearTimeout(this.rtcRetryTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.bus && this.hostId) this.bus.send({ k: 'bye', t: this.hostId }, false);
    const bus = this.bus;
    this.bus = null;
    setTimeout(() => bus?.dispose(), 150);
    this.closeRtc();
    this.ws?.close();
  }
}
