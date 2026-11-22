import { encodePadPacket } from './binary-codec.js';
import type { ConsoleId, PadState, RumbleCommand } from './types.js';

export interface RemoteClientEvents {
  onConnected?: (info: { slot: number; consoleId: ConsoleId; gameTitle: string }) => void;
  onConsoleChanged?: (consoleId: ConsoleId, gameTitle: string) => void;
  onTransportChanged?: (transport: 'webrtc' | 'ws') => void;
  onRumble?: (cmd: RumbleCommand) => void;
  onDisconnected?: (reason?: string) => void;
}

/**
 * Cliente do Controle Remoto VGFA (roda no navegador do celular após escanear o QR Code).
 * Não precisa instalar aplicativo!
 */
export class RemotePadClient {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private slot = 0;
  private seq = 0;
  private disposed = false;

  constructor(
    private readonly signalingUrl: string,
    private readonly roomCode: string,
    private readonly deviceLabel = 'Smartphone VGFA',
    private readonly events: RemoteClientEvents = {},
  ) {}

  getSlot(): number {
    return this.slot;
  }

  connect(): void {
    if (this.disposed) return;
    const ws = new WebSocket(this.signalingUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
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
        this.handleMessage(msg);
      } catch {
        // ignora
      }
    };

    ws.onclose = () => {
      this.events.onDisconnected?.('Conexão encerrada');
    };

    ws.onerror = () => {
      this.events.onDisconnected?.('Erro de rede ao conectar à sala');
    };
  }

  sendState(state: Omit<PadState, 'slot' | 'seq'>): void {
    this.seq++;
    const packet = encodePadPacket({
      ...state,
      slot: this.slot,
      seq: this.seq,
    });

    if (this.dc?.readyState === 'open') {
      this.dc.send(packet.buffer as ArrayBuffer);
    } else if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(packet.buffer as ArrayBuffer);
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'room:joined': {
        this.slot = Number(msg.slot ?? 0);
        const consoleId = (msg.consoleId as ConsoleId) || 'ps2';
        const gameTitle = String(msg.gameTitle || 'VGFA');
        this.events.onTransportChanged?.('ws');
        this.events.onConnected?.({ slot: this.slot, consoleId, gameTitle });
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
        void this.handleWebRtcOffer(msg.sdp as RTCSessionDescriptionInit);
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

  private async handleWebRtcOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (typeof RTCPeerConnection === 'undefined') return;
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      this.pc = pc;

      pc.ondatachannel = (ev) => {
        const dc = ev.channel;
        dc.binaryType = 'arraybuffer';
        this.dc = dc;
        dc.onopen = () => this.events.onTransportChanged?.('webrtc');
        dc.onclose = () => this.events.onTransportChanged?.('ws');
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
      navigator.vibrate(ms);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.dc?.close();
    this.pc?.close();
    this.ws?.close();
  }
}
