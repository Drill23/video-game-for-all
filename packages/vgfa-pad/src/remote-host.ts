import { decodePadPacket } from './binary-codec.js';
import {
  ServerlessTrackerRoom,
  createRtcPeer,
  generateLocalRoomCode,
  waitIceComplete,
} from './serverless-rtc.js';
import type { ConnectedPadInfo, ConsoleId, PadState, RumbleCommand } from './types.js';

export interface RemoteHostEvents {
  onRoomCreated?: (roomCode: string) => void;
  onPadsChanged?: (pads: ConnectedPadInfo[]) => void;
  onPadInput?: (state: PadState) => void;
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected' | 'error', detail?: string) => void;
}

interface PeerSlot {
  peerId: string;
  slot: number;
  label: string;
  pc?: RTCPeerConnection;
  dc?: RTCDataChannel;
  transport: 'phone-ws' | 'phone-webrtc';
  lastSeq: number;
  connectedAt: number;
  latencyMs?: number;
}

/**
 * Host do Controle Remoto VGFA (roda na aba do jogo no PC/TV).
 *
 * - Suporta servidor WebSocket local/nuvem (/ws) E modo 100% Serverless (GitHub Pages!)
 *   via trackers WebTorrent WSS + WebRTC DataChannel direto (0 servidor backend!).
 */
export class RemotePadHost {
  private ws: WebSocket | null = null;
  private serverlessRoom: ServerlessTrackerRoom | null = null;
  private roomCode: string | null = null;
  private consoleId: ConsoleId;
  private gameTitle: string;
  private readonly peers = new Map<string, PeerSlot>();
  private readonly latestStates = new Map<number, PadState>();
  private disposed = false;
  private wsConnectedOnce = false;

  constructor(
    private readonly signalingUrl: string,
    initialConsole: ConsoleId,
    initialGameTitle = 'VGFA',
    private readonly events: RemoteHostEvents = {},
  ) {
    this.consoleId = initialConsole;
    this.gameTitle = initialGameTitle;
  }

  getRoomCode(): string | null {
    return this.roomCode;
  }

  getConnectedPads(): ConnectedPadInfo[] {
    return Array.from(this.peers.values())
      .sort((a, b) => a.slot - b.slot)
      .map((p) => ({
        id: p.peerId,
        slot: p.slot,
        kind: p.transport,
        label: p.label,
        latencyMs: p.latencyMs,
        connectedAt: p.connectedAt,
      }));
  }

  getLatestState(slot: number): PadState | undefined {
    return this.latestStates.get(slot);
  }

  getAllStates(): Map<number, PadState> {
    return new Map(this.latestStates);
  }

  connect(): void {
    if (this.disposed) return;
    this.events.onStatusChange?.('connecting');

    if (this.signalingUrl === 'serverless' || this.signalingUrl.startsWith('serverless://')) {
      this.connectServerless();
      return;
    }

    const ws = new WebSocket(this.signalingUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.wsConnectedOnce = true;
      this.events.onStatusChange?.('connected');
      this.sendJson({
        type: 'host:create',
        consoleId: this.consoleId,
        gameTitle: this.gameTitle,
      });
    };

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        this.handleBinaryPacket(ev.data);
        return;
      }
      try {
        const msg = JSON.parse(String(ev.data));
        this.handleJsonMessage(msg);
      } catch {
        // ignora mensagens malformadas
      }
    };

    ws.onerror = () => {
      if (!this.wsConnectedOnce && !this.disposed && !this.serverlessRoom) {
        // Ambiente estático sem servidor /ws (ex.: GitHub Pages) -> ativa pareamento P2P Serverless!
        ws.close();
        this.connectServerless();
        return;
      }
      this.events.onStatusChange?.('error', 'Falha na conexão com o servidor de controles');
    };

    ws.onclose = () => {
      if (this.serverlessRoom) return;
      if (!this.wsConnectedOnce && !this.disposed) {
        this.connectServerless();
        return;
      }
      this.events.onStatusChange?.('disconnected');
      if (!this.disposed) {
        setTimeout(() => this.connect(), 2500);
      }
    };
  }

  private connectServerless(): void {
    if (this.disposed || this.serverlessRoom) return;
    const code = this.roomCode || generateLocalRoomCode('VGFA');
    this.roomCode = code;
    this.events.onStatusChange?.('connected', 'Modo P2P Serverless (GitHub Pages)');
    this.events.onRoomCreated?.(code);

    const seenOffers = new Set<string>();
    const room = new ServerlessTrackerRoom(code, (fromPeerId, offerId, sdp, trackerWs) => {
      if (seenOffers.has(offerId) || this.disposed) return;
      seenOffers.add(offerId);
      void this.acceptServerlessPeer(fromPeerId, offerId, sdp, trackerWs);
    });
    this.serverlessRoom = room;
    void room.startHost();
  }

  private async acceptServerlessPeer(
    fromPeerId: string,
    offerId: string,
    sdp: RTCSessionDescriptionInit,
    trackerWs: WebSocket,
  ): Promise<void> {
    if (typeof RTCPeerConnection === 'undefined') return;
    const usedSlots = new Set(Array.from(this.peers.values()).map((p) => p.slot));
    let freeSlot = -1;
    for (let s = 0; s < 4; s++) {
      if (!usedSlots.has(s)) {
        freeSlot = s;
        break;
      }
    }
    if (freeSlot === -1) return;

    const pc = createRtcPeer();
    const peer: PeerSlot = {
      peerId: fromPeerId,
      slot: freeSlot,
      label: `Celular P${freeSlot + 1} (P2P)`,
      pc,
      transport: 'phone-webrtc',
      lastSeq: -1,
      connectedAt: Date.now(),
    };
    this.peers.set(fromPeerId, peer);

    pc.ondatachannel = (ev) => {
      const dc = ev.channel;
      dc.binaryType = 'arraybuffer';
      peer.dc = dc;
      dc.onopen = () => {
        dc.send(
          JSON.stringify({
            type: 'welcome',
            slot: peer.slot,
            consoleId: this.consoleId,
            gameTitle: this.gameTitle,
          }),
        );
        this.emitPads();
      };
      dc.onmessage = (m) => {
        if (m.data instanceof ArrayBuffer) {
          this.handleBinaryPacket(m.data);
        } else if (typeof m.data === 'string') {
          try {
            const j = JSON.parse(m.data) as { type?: string; label?: string };
            if (j.type === 'hello' && j.label) {
              peer.label = j.label;
              this.emitPads();
            }
          } catch {}
        }
      };
      dc.onclose = () => {
        this.latestStates.delete(peer.slot);
        this.peers.delete(fromPeerId);
        this.emitPads();
      };
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitIceComplete(pc);
      if (pc.localDescription && this.serverlessRoom) {
        this.serverlessRoom.sendAnswer(trackerWs, fromPeerId, offerId, pc.localDescription);
      }
    } catch {
      pc.close();
      this.peers.delete(fromPeerId);
    }
  }

  setActiveConsole(consoleId: ConsoleId, gameTitle?: string): void {
    this.consoleId = consoleId;
    if (gameTitle) this.gameTitle = gameTitle;
    this.sendJson({
      type: 'host:console',
      consoleId: this.consoleId,
      gameTitle: this.gameTitle,
    });
    for (const peer of this.peers.values()) {
      if (peer.dc?.readyState === 'open') {
        peer.dc.send(JSON.stringify({ type: 'console', consoleId: this.consoleId, gameTitle: this.gameTitle }));
      }
    }
  }

  sendRumble(cmd: RumbleCommand): void {
    for (const peer of this.peers.values()) {
      if (peer.slot !== cmd.slot) continue;
      const payload = JSON.stringify({ type: 'rumble', ...cmd });
      if (peer.dc?.readyState === 'open') {
        peer.dc.send(payload);
      } else {
        this.sendJson({ type: 'host:rumble', peerId: peer.peerId, ...cmd });
      }
    }
  }

  private handleJsonMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'room:created': {
        this.roomCode = String(msg.roomCode);
        this.events.onRoomCreated?.(this.roomCode);
        break;
      }
      case 'pad:joined': {
        const peerId = String(msg.peerId);
        const slot = Number(msg.slot ?? 0);
        const label = String(msg.label || `Celular P${slot + 1}`);
        const peer: PeerSlot = {
          peerId,
          slot,
          label,
          transport: 'phone-ws',
          lastSeq: -1,
          connectedAt: Date.now(),
        };
        this.peers.set(peerId, peer);
        this.emitPads();
        void this.startWebRtcOffer(peer);
        break;
      }
      case 'pad:left': {
        const peerId = String(msg.peerId);
        const peer = this.peers.get(peerId);
        if (peer) {
          peer.dc?.close();
          peer.pc?.close();
          this.latestStates.delete(peer.slot);
          this.peers.delete(peerId);
          this.emitPads();
        }
        break;
      }
      case 'rtc:answer': {
        const peer = this.peers.get(String(msg.peerId));
        if (peer?.pc && msg.sdp) {
          void peer.pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit).catch(() => {});
        }
        break;
      }
      case 'rtc:ice': {
        const peer = this.peers.get(String(msg.peerId));
        if (peer?.pc && msg.candidate) {
          void peer.pc.addIceCandidate(msg.candidate as RTCIceCandidateInit).catch(() => {});
        }
        break;
      }
    }
  }

  private async startWebRtcOffer(peer: PeerSlot): Promise<void> {
    if (typeof RTCPeerConnection === 'undefined') return;
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      peer.pc = pc;

      const dc = pc.createDataChannel('vgfa-pad', {
        ordered: false,
        maxRetransmits: 0,
      });
      dc.binaryType = 'arraybuffer';
      peer.dc = dc;

      dc.onopen = () => {
        peer.transport = 'phone-webrtc';
        dc.send(JSON.stringify({ type: 'console', consoleId: this.consoleId, gameTitle: this.gameTitle }));
        this.emitPads();
      };
      dc.onclose = () => {
        peer.transport = 'phone-ws';
        this.emitPads();
      };
      dc.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          this.handleBinaryPacket(ev.data);
        }
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          this.sendJson({ type: 'rtc:ice', targetPeerId: peer.peerId, candidate: ev.candidate });
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendJson({ type: 'rtc:offer', targetPeerId: peer.peerId, sdp: offer });
    } catch {
      // Continua normalmente pelo fallback WebSocket binário
    }
  }

  private handleBinaryPacket(buf: ArrayBuffer): void {
    const state = decodePadPacket(buf);
    if (!state) return;

    // Descarta pacotes fora de ordem (UDP/WebRTC unordered)
    for (const peer of this.peers.values()) {
      if (peer.slot === state.slot) {
        if (state.seq <= peer.lastSeq && peer.lastSeq - state.seq < 1000) {
          return;
        }
        peer.lastSeq = state.seq;
      }
    }

    this.latestStates.set(state.slot, state);
    this.events.onPadInput?.(state);
  }

  private emitPads(): void {
    this.events.onPadsChanged?.(this.getConnectedPads());
  }

  private sendJson(obj: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.serverlessRoom?.dispose();
    this.serverlessRoom = null;
    for (const peer of this.peers.values()) {
      peer.dc?.close();
      peer.pc?.close();
    }
    this.peers.clear();
    this.ws?.close();
    this.ws = null;
  }
}
