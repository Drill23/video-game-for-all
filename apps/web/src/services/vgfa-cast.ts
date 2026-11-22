import {
  PadStatePump,
  SignalBus,
  VGFA_ICE_SERVERS,
  decodePadPacket,
  generateLocalRoomCode,
  randomBusId,
  waitIceComplete,
  type BusMessage,
  type ConsoleId,
  type PadState,
} from '@vgfa/pad';

/**
 * VGFA-Cast v0.7 — Cloud Gaming P2P sem servidor próprio.
 *
 * Antes dependia do servidor /ws (que não existe no GitHub Pages) e mostrava
 * "Falha ao conectar no servidor VGFA-Cast.". Agora a sinalização passa pelo
 * VGFA Link (brokers MQTT públicos) e o vídeo vai direto por WebRTC.
 */
export class VgfaCastHost {
  private bus: SignalBus | null = null;
  private readonly hostId = randomBusId('c');
  private readonly peers = new Map<string, { pc: RTCPeerConnection; dc?: RTCDataChannel; connected: boolean; lastSeq: number }>();
  private stream: MediaStream | null = null;
  private castCode: string | null = null;
  private disposed = false;
  private readonly offeredAt = new Map<string, number>();

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
      this.callbacks.onError('Aguarde o jogo aparecer na tela antes de ativar o VGFA-Cast.');
      return;
    }
    if (typeof RTCPeerConnection === 'undefined') {
      this.callbacks.onError('Este navegador não suporta WebRTC.');
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

    this.castCode = generateLocalRoomCode('CAST');
    const bus = new SignalBus(
      this.castCode,
      this.hostId,
      (msg) => this.handleMessage(msg),
      (status) => {
        if (status === 'offline' && !this.disposed) {
          this.callbacks.onError('Sem acesso ao canal de transmissão. Verifique sua internet e tente de novo.');
        }
      },
    );
    this.bus = bus;
    bus.start();
    this.callbacks.onCreated(this.castCode);
  }

  private emitViewers(): void {
    let n = 0;
    for (const p of this.peers.values()) if (p.connected) n++;
    this.callbacks.onViewersChanged(n);
  }

  private handleMessage(msg: BusMessage): void {
    if (this.disposed) return;
    const vid = msg.f;
    if (msg.k === 'cast-join') {
      this.bus?.send({ k: 'cast-info', t: vid, consoleId: this.consoleId, gameTitle: this.gameTitle });
      const existing = this.peers.get(vid);
      if (existing && existing.connected) return;
      // oferta já em andamento: só refaz se o espectador continua pedindo depois de 5 s
      if (existing && (!msg.retry || Date.now() - (this.offeredAt.get(vid) ?? 0) < 5000)) return;
      this.offeredAt.set(vid, Date.now());
      void this.offerTo(vid);
    } else if (msg.k === 'cast-answer') {
      const peer = this.peers.get(vid);
      if (peer && msg.sdp) {
        void peer.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit)).catch(() => {});
      }
    } else if (msg.k === 'cast-bye') {
      const peer = this.peers.get(vid);
      peer?.pc.close();
      this.peers.delete(vid);
      this.emitViewers();
    }
  }

  private async offerTo(vid: string): Promise<void> {
    if (!this.stream || !this.bus) return;
    this.peers.get(vid)?.pc.close();
    const pc = new RTCPeerConnection({ iceServers: VGFA_ICE_SERVERS, bundlePolicy: 'max-bundle' });
    const entry: { pc: RTCPeerConnection; dc?: RTCDataChannel; connected: boolean; lastSeq: number } = {
      pc,
      connected: false,
      lastSeq: -1,
    };
    this.peers.set(vid, entry);

    for (const track of this.stream.getTracks()) {
      const sender = pc.addTrack(track, this.stream);
      if (track.kind === 'video') {
        try {
          const params = sender.getParameters();
          params.encodings = [{ maxBitrate: 6_000_000, maxFramerate: 60 }];
          (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
            'maintain-framerate';
          void sender.setParameters(params).catch(() => {});
        } catch {}
      }
    }

    const dc = pc.createDataChannel('vgfa-pad', { ordered: false, maxRetransmits: 0 });
    dc.binaryType = 'arraybuffer';
    entry.dc = dc;
    dc.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      const state = decodePadPacket(ev.data);
      if (!state) return;
      if (entry.lastSeq >= 0 && state.seq <= entry.lastSeq && entry.lastSeq - state.seq < 5000) return;
      entry.lastSeq = state.seq;
      state.slot = 0;
      this.callbacks.onPadInput(state);
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      entry.connected = st === 'connected';
      if (st === 'failed' || st === 'closed') {
        if (this.peers.get(vid) === entry) this.peers.delete(vid);
      }
      this.emitViewers();
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceComplete(pc, 1800);
      if (!pc.localDescription || this.disposed || this.peers.get(vid) !== entry) return;
      this.bus?.send({
        k: 'cast-offer',
        t: vid,
        sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
        consoleId: this.consoleId,
        gameTitle: this.gameTitle,
      });
    } catch {
      pc.close();
      this.peers.delete(vid);
      this.emitViewers();
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const p of this.peers.values()) p.pc.close();
    this.peers.clear();
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    const bus = this.bus;
    this.bus = null;
    if (bus) setTimeout(() => bus.dispose(), 100);
  }
}

/**
 * VGFA-Cast Viewer: abre o link #/watch/CAST-XXXX em qualquer celular ou PC,
 * recebe o vídeo por WebRTC sem baixar o jogo e devolve o controle em 16 bytes.
 */
export class VgfaCastViewer {
  private bus: SignalBus | null = null;
  private readonly viewerId = randomBusId('v');
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private joinTimer: ReturnType<typeof setInterval> | null = null;
  private gotOffer = false;
  private joinedInfo = false;
  private disposed = false;
  private readonly pump: PadStatePump;

  constructor(
    private readonly castCode: string,
    private readonly callbacks: {
      onJoined: (info: { castCode: string; consoleId: ConsoleId; gameTitle: string }) => void;
      onStream: (stream: MediaStream) => void;
      onError: (msg: string) => void;
    },
  ) {
    this.pump = new PadStatePump({
      mode: () => (this.dc?.readyState === 'open' ? 'fast' : 'none'),
      sendFast: (packet) => {
        try {
          this.dc?.send(packet.buffer as ArrayBuffer);
        } catch {}
      },
      sendSlow: () => {},
    });
  }

  connect(): void {
    if (typeof RTCPeerConnection === 'undefined') {
      this.callbacks.onError('Este navegador não suporta WebRTC.');
      return;
    }
    const code = this.castCode.trim().toUpperCase();
    const bus = new SignalBus(
      code,
      this.viewerId,
      (msg) => void this.handleMessage(msg),
      (status) => {
        if (status === 'offline' && !this.disposed && !this.gotOffer) {
          this.callbacks.onError('Sem acesso ao canal de transmissão. Verifique a internet.');
        }
      },
    );
    this.bus = bus;
    bus.start();
    this.pump.start();
    const started = Date.now();
    let attempts = 0;
    const join = () => {
      if (this.disposed || this.gotOffer) return;
      attempts++;
      bus.send({ k: 'cast-join', retry: attempts > 4 }, false);
      if (Date.now() - started > 40_000) {
        if (this.joinTimer) clearInterval(this.joinTimer);
        this.callbacks.onError('Transmissão não encontrada. Confira o link ou peça um novo ao seu amigo.');
      }
    };
    join();
    this.joinTimer = setInterval(join, 1500);
  }

  private async handleMessage(msg: BusMessage): Promise<void> {
    if (this.disposed) return;
    if (msg.k === 'cast-info' && !this.joinedInfo) {
      this.joinedInfo = true;
      this.callbacks.onJoined({
        castCode: this.castCode,
        consoleId: (msg.consoleId as ConsoleId) || 'ps2',
        gameTitle: String(msg.gameTitle || 'VGFA Live'),
      });
      return;
    }
    if (msg.k !== 'cast-offer' || !msg.sdp) return;
    this.gotOffer = true;
    if (this.joinTimer) clearInterval(this.joinTimer);
    if (!this.joinedInfo) {
      this.joinedInfo = true;
      this.callbacks.onJoined({
        castCode: this.castCode,
        consoleId: (msg.consoleId as ConsoleId) || 'ps2',
        gameTitle: String(msg.gameTitle || 'VGFA Live'),
      });
    }

    this.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: VGFA_ICE_SERVERS, bundlePolicy: 'max-bundle' });
    this.pc = pc;
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      this.callbacks.onStream(stream);
    };
    pc.ondatachannel = (ev) => {
      const dc = ev.channel;
      dc.binaryType = 'arraybuffer';
      this.dc = dc;
      dc.onopen = () => this.pump.resync();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.callbacks.onError(
          'A conexão direta falhou (rede bloqueia P2P). Tente com os dois aparelhos na mesma rede Wi-Fi.',
        );
      }
    };
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitIceComplete(pc, 1800);
      if (!pc.localDescription || this.disposed) return;
      this.bus?.send({
        k: 'cast-answer',
        t: msg.f,
        sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
      });
    } catch {
      this.callbacks.onError('Não foi possível abrir a transmissão.');
    }
  }

  sendPad(state: PadState): void {
    this.pump.update(state);
  }

  dispose(): void {
    this.disposed = true;
    if (this.joinTimer) clearInterval(this.joinTimer);
    this.pump.stop();
    this.bus?.send({ k: 'cast-bye' }, false);
    const bus = this.bus;
    this.bus = null;
    setTimeout(() => bus?.dispose(), 100);
    this.pc?.close();
    this.pc = null;
  }
}
