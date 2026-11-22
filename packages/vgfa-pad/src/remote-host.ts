import { decodePadPacket } from './binary-codec.js';
import { SignalBus, base64ToPacket, randomBusId, type BusMessage, type BusStatus } from './signal-bus.js';
import { createRtcPeer, generateLocalRoomCode, waitIceComplete } from './serverless-rtc.js';
import { createEmptyPadState, type ConnectedPadInfo, type ConsoleId, type PadState, type RumbleCommand } from './types.js';

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
  transport: 'phone-ws' | 'phone-webrtc' | 'phone-relay';
  lastSeq: number;
  lastSeenAt: number;
  connectedAt: number;
  latencyMs?: number;
  /** pareado pelo VGFA Link (sem servidor) */
  link: boolean;
}

/** Tempo sem pacotes até soltar os botões daquele jogador (evita botão preso). */
const STALE_FAST_MS = 1200;
const STALE_SLOW_MS = 4000;
/** Tempo sem sinal até liberar a vaga do jogador. */
const DROP_PEER_MS = 45_000;

function stableRoomCode(): string {
  try {
    const key = 'vgfa:pad-room-code';
    const existing = sessionStorage.getItem(key);
    if (existing && /^VGFA-[A-Z0-9]{4,6}$/.test(existing)) return existing;
    const code = generateLocalRoomCode('VGFA');
    sessionStorage.setItem(key, code);
    return code;
  } catch {
    return generateLocalRoomCode('VGFA');
  }
}

/**
 * Host do Controle Remoto VGFA (roda na aba do jogo no PC/TV/iPad).
 *
 * - Com servidor próprio (/ws): igual antes.
 * - Sem servidor (GitHub Pages): VGFA Link — sala num tópico MQTT público,
 *   relé imediato + upgrade automático para WebRTC direto.
 * - O código da sala sobrevive a recarregar a aba (os celulares voltam sozinhos).
 * - Cada celular guarda seu jogador (P1 continua P1 mesmo após reconectar).
 * - Jogador que para de mandar sinal tem os botões soltos automaticamente.
 */
export class RemotePadHost {
  private ws: WebSocket | null = null;
  private bus: SignalBus | null = null;
  private readonly hostId = randomBusId('h');
  private roomCode: string | null = null;
  private consoleId: ConsoleId;
  private gameTitle: string;
  private readonly peers = new Map<string, PeerSlot>();
  /** lembra a vaga de cada aparelho durante a sessão */
  private readonly clientSlots = new Map<string, number>();
  private readonly latestStates = new Map<number, PadState>();
  private readonly stateTimes = new Map<number, number>();
  private disposed = false;
  private wsConnectedOnce = false;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private beaconTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onPageHide = () => this.bus?.send({ k: 'host-bye' }, false);

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

  /** Estado mais recente do jogador — somente se ainda estiver "vivo". */
  getLatestState(slot: number): PadState | undefined {
    const state = this.latestStates.get(slot);
    if (!state) return undefined;
    const at = this.stateTimes.get(slot) ?? 0;
    const peer = this.peerBySlot(slot);
    const limit = peer && peer.transport === 'phone-webrtc' ? STALE_FAST_MS : STALE_SLOW_MS;
    if (Date.now() - at > limit) return undefined;
    return state;
  }

  getAllStates(): Map<number, PadState> {
    const out = new Map<number, PadState>();
    for (const slot of this.latestStates.keys()) {
      const s = this.getLatestState(slot);
      if (s) out.set(slot, s);
    }
    return out;
  }

  connect(): void {
    if (this.disposed) return;
    this.events.onStatusChange?.('connecting');
    this.sweepTimer = setInterval(() => this.sweep(), 400);

    if (this.signalingUrl === 'serverless' || this.signalingUrl.startsWith('serverless://')) {
      this.connectLink();
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
        this.handleWsBinaryPacket(ev.data);
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
      if (!this.wsConnectedOnce && !this.disposed && !this.bus) {
        try {
          ws.close();
        } catch {}
      }
    };

    ws.onclose = () => {
      if (this.bus || this.disposed) return;
      if (!this.wsConnectedOnce) {
        // Ambiente estático sem servidor /ws (ex.: GitHub Pages) -> VGFA Link sem servidor
        this.ws = null;
        this.connectLink();
        return;
      }
      this.events.onStatusChange?.('disconnected');
      setTimeout(() => {
        if (!this.disposed) this.connect();
      }, 2500);
    };
  }

  // ---------------------------------------------------------------- VGFA Link (sem servidor)

  private connectLink(): void {
    if (this.disposed || this.bus) return;
    const code = this.roomCode || stableRoomCode();
    this.roomCode = code;
    this.events.onRoomCreated?.(code);

    const bus = new SignalBus(
      code,
      this.hostId,
      (msg) => this.handleBusMessage(msg),
      (status: BusStatus, n: number) => {
        if (status === 'online') {
          this.events.onStatusChange?.('connected', `VGFA Link online (${n} canal${n > 1 ? 'is' : ''})`);
        } else if (status === 'offline') {
          this.events.onStatusChange?.('error', 'Sem acesso ao canal de pareamento (verifique a internet).');
        }
      },
    );
    this.bus = bus;
    bus.start();
    this.beaconTimer = setInterval(() => {
      if (this.peers.size > 0) {
        bus.send({ k: 'host', consoleId: this.consoleId, gameTitle: this.gameTitle }, false);
      }
    }, 4000);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onPageHide);
  }

  private pickSlot(clientId: string): number {
    const used = new Set<number>();
    for (const p of this.peers.values()) if (p.peerId !== clientId) used.add(p.slot);
    const remembered = this.clientSlots.get(clientId);
    if (remembered !== undefined && !used.has(remembered)) return remembered;
    for (let s = 0; s < 4; s++) if (!used.has(s)) return s;
    return -1;
  }

  private handleBusMessage(msg: BusMessage): void {
    if (this.disposed) return;
    const cid = msg.f;
    switch (msg.k) {
      case 'join': {
        let peer = this.peers.get(cid);
        if (!peer) {
          const slot = this.pickSlot(cid);
          if (slot < 0) {
            this.bus?.send({ k: 'full', t: cid }, false);
            return;
          }
          peer = {
            peerId: cid,
            slot,
            label: String(msg.label || `Celular P${slot + 1}`).slice(0, 40),
            transport: 'phone-relay',
            lastSeq: -1,
            lastSeenAt: Date.now(),
            connectedAt: Date.now(),
            link: true,
          };
          this.peers.set(cid, peer);
          this.clientSlots.set(cid, slot);
        }
        peer.lastSeenAt = Date.now();
        peer.lastSeq = -1; // novo início de sessão do aparelho
        this.bus?.send({
          k: 'welcome',
          t: cid,
          slot: peer.slot,
          consoleId: this.consoleId,
          gameTitle: this.gameTitle,
        });
        this.emitPads();
        break;
      }
      case 'offer': {
        const peer = this.peers.get(cid);
        if (!peer || !msg.sdp) return;
        peer.lastSeenAt = Date.now();
        void this.acceptLinkOffer(peer, String(msg.oid || ''), msg.sdp as RTCSessionDescriptionInit);
        break;
      }
      case 'pad': {
        const peer = this.peers.get(cid);
        if (!peer || typeof msg.p !== 'string') return;
        const bytes = base64ToPacket(msg.p);
        if (bytes) this.handlePeerPacket(peer, bytes);
        break;
      }
      case 'bye': {
        this.removePeer(cid);
        break;
      }
      default:
        break;
    }
  }

  private async acceptLinkOffer(peer: PeerSlot, offerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    if (typeof RTCPeerConnection === 'undefined') return;
    // Descarta a conexão antiga desse aparelho (reconexão)
    const oldDc = peer.dc;
    const oldPc = peer.pc;
    peer.dc = undefined;
    peer.pc = undefined;
    try {
      oldDc?.close();
    } catch {}
    try {
      oldPc?.close();
    } catch {}

    const pc = createRtcPeer();
    peer.pc = pc;

    pc.ondatachannel = (ev) => {
      const dc = ev.channel;
      dc.binaryType = 'arraybuffer';
      peer.dc = dc;
      dc.onopen = () => {
        if (peer.dc !== dc) return;
        peer.transport = 'phone-webrtc';
        peer.lastSeenAt = Date.now();
        try {
          dc.send(
            JSON.stringify({
              type: 'welcome',
              slot: peer.slot,
              consoleId: this.consoleId,
              gameTitle: this.gameTitle,
            }),
          );
        } catch {}
        this.emitPads();
      };
      dc.onmessage = (m) => {
        if (m.data instanceof ArrayBuffer) {
          this.handlePeerPacket(peer, new Uint8Array(m.data));
        } else if (typeof m.data === 'string') {
          try {
            const j = JSON.parse(m.data) as { type?: string; label?: string };
            if (j.type === 'hello' && j.label) {
              peer.label = String(j.label).slice(0, 40);
              this.emitPads();
            }
          } catch {}
        }
      };
      dc.onclose = () => {
        if (peer.dc !== dc) return;
        peer.dc = undefined;
        if (this.peers.get(peer.peerId) === peer) {
          peer.transport = 'phone-relay';
          this.emitPads();
        }
      };
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitIceComplete(pc, 1500);
      if (pc.localDescription && this.bus && peer.pc === pc) {
        this.bus.send({
          k: 'answer',
          t: peer.peerId,
          oid: offerId,
          sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
        });
      }
    } catch {
      try {
        pc.close();
      } catch {}
      if (peer.pc === pc) peer.pc = undefined;
    }
  }

  private handlePeerPacket(peer: PeerSlot, bytes: Uint8Array): void {
    const state = decodePadPacket(bytes);
    if (!state) return;
    peer.lastSeenAt = Date.now();
    // Pacote atrasado (chegou depois de um mais novo): ignora. Sequência reiniciada: aceita.
    if (peer.lastSeq >= 0 && state.seq <= peer.lastSeq && peer.lastSeq - state.seq < 5000) return;
    peer.lastSeq = state.seq;
    // O host é a autoridade do número do jogador (evita P2 "fantasma")
    state.slot = peer.slot;
    this.commitState(state);
  }

  private commitState(state: PadState): void {
    this.latestStates.set(state.slot, state);
    this.stateTimes.set(state.slot, Date.now());
    this.events.onPadInput?.(state);
  }

  private peerBySlot(slot: number): PeerSlot | undefined {
    for (const p of this.peers.values()) if (p.slot === slot) return p;
    return undefined;
  }

  /** Solta botões de quem sumiu e libera vagas abandonadas. */
  private sweep(): void {
    const now = Date.now();
    for (const [slot, state] of this.latestStates) {
      const at = this.stateTimes.get(slot) ?? 0;
      const peer = this.peerBySlot(slot);
      const limit = peer && peer.transport === 'phone-webrtc' ? STALE_FAST_MS : STALE_SLOW_MS;
      if (now - at > limit && (state.buttons !== 0 || state.lx || state.ly || state.rx || state.ry)) {
        const zero = createEmptyPadState(slot);
        zero.seq = state.seq;
        this.latestStates.set(slot, zero);
        this.events.onPadInput?.(zero);
      }
    }
    let changed = false;
    for (const peer of Array.from(this.peers.values())) {
      if (!peer.link) continue;
      const dcOpen = peer.dc?.readyState === 'open';
      if (!dcOpen && now - peer.lastSeenAt > DROP_PEER_MS) {
        this.removePeer(peer.peerId, false);
        changed = true;
      }
    }
    if (changed) this.emitPads();
  }

  private removePeer(peerId: string, emit = true): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    try {
      peer.dc?.close();
    } catch {}
    try {
      peer.pc?.close();
    } catch {}
    this.peers.delete(peerId);
    const zero = createEmptyPadState(peer.slot);
    this.latestStates.delete(peer.slot);
    this.stateTimes.delete(peer.slot);
    this.events.onPadInput?.(zero);
    if (emit) this.emitPads();
  }

  setActiveConsole(consoleId: ConsoleId, gameTitle?: string): void {
    this.consoleId = consoleId;
    if (gameTitle) this.gameTitle = gameTitle;
    this.sendJson({
      type: 'host:console',
      consoleId: this.consoleId,
      gameTitle: this.gameTitle,
    });
    this.bus?.send({ k: 'console', consoleId: this.consoleId, gameTitle: this.gameTitle }, false);
    for (const peer of this.peers.values()) {
      if (peer.dc?.readyState === 'open') {
        try {
          peer.dc.send(JSON.stringify({ type: 'console', consoleId: this.consoleId, gameTitle: this.gameTitle }));
        } catch {}
      }
    }
  }

  sendRumble(cmd: RumbleCommand): void {
    for (const peer of this.peers.values()) {
      if (peer.slot !== cmd.slot) continue;
      const payload = JSON.stringify({ type: 'rumble', ...cmd });
      if (peer.dc?.readyState === 'open') {
        try {
          peer.dc.send(payload);
        } catch {}
      } else if (peer.link) {
        this.bus?.send({ k: 'rumble', t: peer.peerId, ...cmd }, false);
      } else {
        this.sendJson({ type: 'host:rumble', peerId: peer.peerId, ...cmd });
      }
    }
  }

  // ---------------------------------------------------------------- Servidor próprio (/ws)

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
          lastSeenAt: Date.now(),
          connectedAt: Date.now(),
          link: false,
        };
        this.peers.set(peerId, peer);
        this.emitPads();
        void this.startWsWebRtcOffer(peer);
        break;
      }
      case 'pad:left': {
        this.removePeer(String(msg.peerId));
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

  private async startWsWebRtcOffer(peer: PeerSlot): Promise<void> {
    if (typeof RTCPeerConnection === 'undefined') return;
    try {
      const pc = createRtcPeer();
      peer.pc = pc;

      const dc = pc.createDataChannel('vgfa-pad', {
        ordered: false,
        maxRetransmits: 0,
      });
      dc.binaryType = 'arraybuffer';
      peer.dc = dc;

      dc.onopen = () => {
        peer.transport = 'phone-webrtc';
        try {
          dc.send(JSON.stringify({ type: 'console', consoleId: this.consoleId, gameTitle: this.gameTitle }));
        } catch {}
        this.emitPads();
      };
      dc.onclose = () => {
        peer.transport = 'phone-ws';
        this.emitPads();
      };
      dc.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          this.handlePeerPacket(peer, new Uint8Array(ev.data));
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

  /** Pacotes pelo WebSocket do servidor não dizem de quem vieram: casa pelo número do jogador. */
  private handleWsBinaryPacket(buf: ArrayBuffer): void {
    const state = decodePadPacket(buf);
    if (!state) return;
    const peer = this.peerBySlot(state.slot);
    if (peer) {
      peer.lastSeenAt = Date.now();
      if (peer.lastSeq >= 0 && state.seq <= peer.lastSeq && peer.lastSeq - state.seq < 5000) return;
      peer.lastSeq = state.seq;
    }
    this.commitState(state);
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
    if (this.disposed) return;
    this.disposed = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.beaconTimer) clearInterval(this.beaconTimer);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
    const bus = this.bus;
    this.bus = null;
    if (bus) {
      bus.send({ k: 'host-bye' }, false);
      setTimeout(() => bus.dispose(), 150);
    }
    for (const peer of this.peers.values()) {
      try {
        peer.dc?.close();
      } catch {}
      try {
        peer.pc?.close();
      } catch {}
    }
    this.peers.clear();
    this.ws?.close();
    this.ws = null;
  }
}
