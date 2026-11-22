/**
 * VGFA Serverless P2P WebRTC Signaling (v0.6)
 *
 * Permite pareamento de Celular via QR Code (16 bytes binários sobre WebRTC DataChannel)
 * 100% SEM SERVIDOR BACKEND — rodando direto do GitHub Pages (grátis para sempre)!
 * Usa trackers WebTorrent WSS públicos para trocar SDP Offer/Answer completos (non-trickle ICE).
 */

const TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
];

export const VGFA_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
const ICE_SERVERS = VGFA_ICE_SERVERS;

export function generateLocalRoomCode(prefix = 'VGFA'): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${prefix}-${code}`;
}

export async function roomToInfoHash(roomCode: string): Promise<string> {
  const clean = roomCode.trim().toUpperCase();
  const normalized = clean.startsWith('VGFA-') || clean.startsWith('CAST-') ? clean : `VGFA-${clean}`;
  const input = new TextEncoder().encode(`vgfa-p2p-v6::${normalized}`);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', input));
    let latin1 = '';
    for (let i = 0; i < 20; i++) latin1 += String.fromCharCode(digest[i]);
    return latin1;
  }
  // Fallback determinístico 20 bytes
  let out = '';
  for (let i = 0; i < 20; i++) {
    out += String.fromCharCode((normalized.charCodeAt(i % normalized.length) + i * 31) & 0xff);
  }
  return out;
}

export function randomPeerId(): string {
  const hex = Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `-VG0600-${hex}`;
}

export function waitIceComplete(pc: RTCPeerConnection, timeoutMs = 2200): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

export class ServerlessTrackerRoom {
  private sockets: WebSocket[] = [];
  private disposed = false;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private infoHash = '';
  readonly peerId = randomPeerId();

  constructor(
    readonly roomCode: string,
    private readonly onOffer?: (fromPeerId: string, offerId: string, sdp: RTCSessionDescriptionInit, ws: WebSocket) => void,
    private readonly onAnswer?: (fromPeerId: string, offerId: string, sdp: RTCSessionDescriptionInit) => void,
  ) {}

  async startHost(): Promise<void> {
    this.infoHash = await roomToInfoHash(this.roomCode);
    for (const url of TRACKERS) {
      this.openTracker(url, () => {
        this.announceOnAll();
      });
    }
    this.keepAliveTimer = setInterval(() => {
      if (!this.disposed) this.announceOnAll();
    }, 25_000);
  }

  async sendOffer(offerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    this.infoHash = await roomToInfoHash(this.roomCode);
    const payload = JSON.stringify({
      action: 'announce',
      info_hash: this.infoHash,
      peer_id: this.peerId,
      numwant: 6,
      uploaded: 0,
      downloaded: 0,
      left: 1,
      offers: [{ offer_id: offerId, offer: { type: offer.type, sdp: offer.sdp } }],
    });

    if (this.sockets.length === 0) {
      for (const url of TRACKERS) {
        this.openTracker(url, (ws) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(payload);
        });
      }
      return;
    }

    for (const ws of this.sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  sendAnswer(ws: WebSocket, toPeerId: string, offerId: string, answer: RTCSessionDescriptionInit): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        action: 'announce',
        info_hash: this.infoHash,
        peer_id: this.peerId,
        to_peer_id: toPeerId,
        offer_id: offerId,
        answer: { type: answer.type, sdp: answer.sdp },
      }),
    );
  }

  private announceOnAll(): void {
    const msg = JSON.stringify({
      action: 'announce',
      info_hash: this.infoHash,
      peer_id: this.peerId,
      numwant: 6,
      uploaded: 0,
      downloaded: 0,
      left: 1,
    });
    for (const ws of this.sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  private openTracker(url: string, onReady: (ws: WebSocket) => void): void {
    if (this.disposed) return;
    try {
      const ws = new WebSocket(url);
      this.sockets.push(ws);
      ws.onopen = () => {
        if (!this.disposed) onReady(ws);
      };
      ws.onmessage = (ev) => {
        if (this.disposed || typeof ev.data !== 'string') return;
        try {
          const m = JSON.parse(ev.data) as Record<string, unknown>;
          if (m.offer && m.peer_id && m.offer_id && this.onOffer) {
            this.onOffer(String(m.peer_id), String(m.offer_id), m.offer as RTCSessionDescriptionInit, ws);
          } else if (m.answer && m.peer_id && m.offer_id && this.onAnswer) {
            this.onAnswer(String(m.peer_id), String(m.offer_id), m.answer as RTCSessionDescriptionInit);
          }
        } catch {
          // ignora
        }
      };
      ws.onerror = () => {};
    } catch {
      // ignora tracker indisponível
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    for (const ws of this.sockets) {
      try {
        ws.close();
      } catch {}
    }
    this.sockets = [];
  }
}

export function createRtcPeer(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' });
}
