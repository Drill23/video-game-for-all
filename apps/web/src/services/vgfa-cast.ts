import { decodePadPacket, encodePadPacket, type ConsoleId, type PadState } from '@vgfa/pad';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

/**
 * VGFA-Cast Host: transforma o PC/Mac em um servidor Cloud Gaming P2P pessoal em 60 FPS!
 * Captura o <canvas> do jogo (mesmo dentro de iframe same-origin) via captureStream(60),
 * transmite por WebRTC para qualquer amigo no mundo (celular fraco / Safari / PC) com 0 MB baixados
 * e recebe os comandos do controle em pacotes binários de 16 bytes em tempo real!
 */
export class VgfaCastHost {
  private ws: WebSocket | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private stream: MediaStream | null = null;
  private castCode: string | null = null;
  private disposed = false;

  constructor(
    private readonly consoleId: ConsoleId,
    private readonly gameTitle: string,
    private readonly resolveCanvas: () => HTMLCanvasElement | null,
    private readonly callbacks: {
      onCreated: (castCode: string) => void;
      onViewersChanged: (count: number) => void;
      onPadInput: (state: PadState) => void;
      onError: (msg: string) => void;
    },
  ) {}

  start(): void {
    const canvas = this.resolveCanvas();
    if (!canvas || typeof canvas.captureStream !== 'function') {
      this.callbacks.onError('Aguarde o jogo iniciar na tela antes de ativar o VGFA-Cast 60 FPS.');
      return;
    }

    try {
      this.stream = canvas.captureStream(60);
    } catch (err) {
      this.callbacks.onError(
        `Não foi possível capturar o vídeo do jogo: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    const ws = new WebSocket(getWsUrl());
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'cast:create',
          consoleId: this.consoleId,
          gameTitle: this.gameTitle,
        }),
      );
    };

    ws.onerror = () => {
      if (!this.disposed) this.callbacks.onError('Falha ao conectar no servidor VGFA-Cast.');
    };

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        const decoded = decodePadPacket(new Uint8Array(ev.data));
        if (decoded) this.callbacks.onPadInput(decoded);
        return;
      }

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(msg.type || '');
      if (type === 'cast:created') {
        this.castCode = String(msg.castCode || '');
        this.callbacks.onCreated(this.castCode);
      } else if (type === 'cast:viewer-joined') {
        void this.handleViewerJoined(String(msg.viewerId || ''));
      } else if (type === 'cast:viewer-left') {
        const viewerId = String(msg.viewerId || '');
        this.peers.get(viewerId)?.close();
        this.peers.delete(viewerId);
        this.callbacks.onViewersChanged(this.peers.size);
      } else if (type === 'cast:answer') {
        const pc = this.peers.get(String(msg.viewerId || ''));
        if (pc && msg.sdp) {
          void pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit)).catch(() => {});
        }
      } else if (type === 'cast:ice') {
        const pc = this.peers.get(String(msg.viewerId || ''));
        if (pc && msg.candidate) {
          void pc.addIceCandidate(new RTCIceCandidate(msg.candidate as RTCIceCandidateInit)).catch(() => {});
        }
      }
    };
  }

  private async handleViewerJoined(viewerId: string): Promise<void> {
    if (!this.stream || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peers.set(viewerId, pc);
    this.callbacks.onViewersChanged(this.peers.size);

    for (const track of this.stream.getTracks()) {
      pc.addTrack(track, this.stream);
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'cast:ice', viewerId, candidate: ev.candidate }));
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.ws.send(JSON.stringify({ type: 'cast:offer', viewerId, sdp: offer }));
    } catch {
      pc.close();
      this.peers.delete(viewerId);
      this.callbacks.onViewersChanged(this.peers.size);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const pc of this.peers.values()) pc.close();
    this.peers.clear();
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

/**
 * VGFA-Cast Viewer: abre o link /watch/CAST-XXXX em qualquer celular ou PC,
 * recebe o stream 60 FPS por WebRTC sem baixar nada e devolve o controle em 16 bytes!
 */
export class VgfaCastViewer {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private seq = 1;

  constructor(
    private readonly castCode: string,
    private readonly callbacks: {
      onJoined: (info: { castCode: string; consoleId: ConsoleId; gameTitle: string }) => void;
      onStream: (stream: MediaStream) => void;
      onError: (msg: string) => void;
    },
  ) {}

  connect(): void {
    const ws = new WebSocket(getWsUrl());
    this.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'cast:join', castCode: this.castCode, label: 'Jogador Remoto' }));
    };

    ws.onerror = () => {
      this.callbacks.onError('Não foi possível conectar à transmissão VGFA-Cast.');
    };

    ws.onmessage = async (ev) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(msg.type || '');
      if (type === 'cast:error') {
        this.callbacks.onError(String(msg.message || 'Transmissão indisponível.'));
      } else if (type === 'cast:joined') {
        this.callbacks.onJoined({
          castCode: String(msg.castCode || this.castCode),
          consoleId: (msg.consoleId as ConsoleId) || 'ps2',
          gameTitle: String(msg.gameTitle || 'VGFA Live'),
        });
      } else if (type === 'cast:offer' && msg.sdp) {
        this.pc?.close();
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        this.pc = pc;

        pc.ontrack = (trackEv) => {
          const stream = trackEv.streams[0] || new MediaStream([trackEv.track]);
          this.callbacks.onStream(stream);
        };

        pc.onicecandidate = (iceEv) => {
          if (iceEv.candidate && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'cast:ice', candidate: iceEv.candidate }));
          }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'cast:answer', sdp: answer }));
      } else if (type === 'cast:ice' && msg.candidate && this.pc) {
        await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate as RTCIceCandidateInit)).catch(() => {});
      }
    };
  }

  sendPad(state: PadState): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const pkt = encodePadPacket({ ...state, seq: this.seq++ });
    this.ws.send(pkt);
  }

  dispose(): void {
    this.pc?.close();
    this.pc = null;
    this.ws?.close();
    this.ws = null;
  }
}
