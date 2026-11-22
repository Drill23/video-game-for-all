import http from 'node:http';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const DEFAULT_PORT = Number(process.env.VGFA_SIGNALING_PORT || 8787);
const WEB_PORT = Number(process.env.VGFA_WEB_PORT || 5173);

interface PadPeer {
  peerId: string;
  slot: number;
  label: string;
  ws: WebSocket;
}

interface Room {
  code: string;
  hostWs: WebSocket;
  consoleId: string;
  gameTitle: string;
  pads: Map<string, PadPeer>;
  createdAt: number;
}

export function createSignalingServer(port = DEFAULT_PORT) {
const rooms = new Map<string, Room>();

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(): string {
  for (let tries = 0; tries < 50; tries++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    const full = `VGFA-${code}`;
    if (!rooms.has(full)) return full;
  }
  return `VGFA-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

function getLanAddresses(): string[] {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const net of list) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        service: 'vgfa-signaling',
        activeRooms: rooms.size,
        uptimeSec: Math.round(process.uptime()),
      }),
    );
    return;
  }

  if (req.url === '/api/network-info') {
    const lanIps = getLanAddresses();
    const primaryLan = lanIps[0] ?? '127.0.0.1';
    const addr = server.address();
    const activePort = typeof addr === 'object' && addr ? addr.port : port;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        lanIp: primaryLan,
        allLanIps: lanIps,
        webPort: WEB_PORT,
        signalingPort: activePort,
        controllerBaseUrl: `http://${primaryLan}:${WEB_PORT}`,
      }),
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let role: 'host' | 'pad' | null = null;
  let roomCode: string | null = null;
  let peerId: string | null = null;

  ws.on('message', (data, isBinary) => {
    // Pacote binário de 16 bytes do celular -> encaminha direto ao host sem parsing JSON!
    if (isBinary) {
      if (role === 'pad' && roomCode) {
        const room = rooms.get(roomCode);
        if (room && room.hostWs.readyState === WebSocket.OPEN) {
          room.hostWs.send(data, { binary: true });
        }
      }
      return;
    }

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    const type = String(msg.type || '');

    if (type === 'host:create') {
      role = 'host';
      roomCode = generateRoomCode();
      const room: Room = {
        code: roomCode,
        hostWs: ws,
        consoleId: String(msg.consoleId || 'ps2'),
        gameTitle: String(msg.gameTitle || 'VGFA'),
        pads: new Map(),
        createdAt: Date.now(),
      };
      rooms.set(roomCode, room);
      sendJson(ws, { type: 'room:created', roomCode });
      return;
    }

    if (type === 'host:console' && role === 'host' && roomCode) {
      const room = rooms.get(roomCode);
      if (!room) return;
      room.consoleId = String(msg.consoleId || room.consoleId);
      room.gameTitle = String(msg.gameTitle || room.gameTitle);
      for (const pad of room.pads.values()) {
        sendJson(pad.ws, {
          type: 'host:console',
          consoleId: room.consoleId,
          gameTitle: room.gameTitle,
        });
      }
      return;
    }

    if (type === 'host:rumble' && role === 'host' && roomCode) {
      const room = rooms.get(roomCode);
      if (!room) return;
      const target = room.pads.get(String(msg.peerId || ''));
      if (target) {
        sendJson(target.ws, {
          type: 'host:rumble',
          slot: target.slot,
          strong: msg.strong,
          weak: msg.weak,
          durationMs: msg.durationMs,
        });
      }
      return;
    }

    if (type === 'pad:join') {
      const requested = String(msg.roomCode || '').trim().toUpperCase();
      const normalized = requested.startsWith('VGFA-') ? requested : `VGFA-${requested}`;
      const room = rooms.get(requested) ?? rooms.get(normalized);
      if (!room) {
        sendJson(ws, { type: 'room:error', message: `Sala ${requested} não encontrada.` });
        return;
      }

      // Encontra próximo slot livre (0..3)
      const usedSlots = new Set(Array.from(room.pads.values()).map((p) => p.slot));
      let freeSlot = -1;
      for (let s = 0; s < 4; s++) {
        if (!usedSlots.has(s)) {
          freeSlot = s;
          break;
        }
      }
      if (freeSlot === -1) {
        sendJson(ws, { type: 'room:error', message: 'Sala lotada (máximo 4 jogadores).' });
        return;
      }

      role = 'pad';
      roomCode = room.code;
      peerId = `pad_${Math.random().toString(36).slice(2, 10)}`;
      const label = String(msg.label || `Celular P${freeSlot + 1}`);
      room.pads.set(peerId, { peerId, slot: freeSlot, label, ws });

      sendJson(ws, {
        type: 'room:joined',
        roomCode: room.code,
        peerId,
        slot: freeSlot,
        consoleId: room.consoleId,
        gameTitle: room.gameTitle,
      });

      sendJson(room.hostWs, {
        type: 'pad:joined',
        peerId,
        slot: freeSlot,
        label,
      });
      return;
    }

    // Sinalização WebRTC (offer / answer / ice) entre Host e Celular
    if (type === 'rtc:offer' && role === 'host' && roomCode) {
      const room = rooms.get(roomCode);
      const target = room?.pads.get(String(msg.targetPeerId || ''));
      if (target) {
        sendJson(target.ws, { type: 'rtc:offer', sdp: msg.sdp });
      }
      return;
    }

    if (type === 'rtc:answer' && role === 'pad' && roomCode && peerId) {
      const room = rooms.get(roomCode);
      if (room) {
        sendJson(room.hostWs, { type: 'rtc:answer', peerId, sdp: msg.sdp });
      }
      return;
    }

    if (type === 'rtc:ice' && roomCode) {
      const room = rooms.get(roomCode);
      if (!room) return;
      if (role === 'host') {
        const target = room.pads.get(String(msg.targetPeerId || ''));
        if (target) sendJson(target.ws, { type: 'rtc:ice', candidate: msg.candidate });
      } else if (role === 'pad' && peerId) {
        sendJson(room.hostWs, { type: 'rtc:ice', peerId, candidate: msg.candidate });
      }
    }
  });

  ws.on('close', () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (role === 'host') {
      for (const pad of room.pads.values()) {
        sendJson(pad.ws, { type: 'room:error', message: 'A tela principal encerrou a sala.' });
        pad.ws.close();
      }
      rooms.delete(roomCode);
    } else if (role === 'pad' && peerId) {
      room.pads.delete(peerId);
      sendJson(room.hostWs, { type: 'pad:left', peerId });
    }
  });
});

  return {
    server,
    wss,
    start(): Promise<number> {
      return new Promise((resolve) => {
        server.listen(port, '0.0.0.0', () => {
          const addr = server.address();
          const boundPort = typeof addr === 'object' && addr ? addr.port : port;
          const lans = getLanAddresses();
          console.log(`[VGFA Signaling] Rodando em ws://0.0.0.0:${boundPort}`);
          console.log(`[VGFA Signaling] IP LAN detectado para QR Code do celular: ${lans[0] ?? '127.0.0.1'}`);
          resolve(boundPort);
        });
      });
    },
    close(): Promise<void> {
      return new Promise((resolve) => {
        wss.close(() => {
          server.close(() => resolve());
        });
      });
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void createSignalingServer(DEFAULT_PORT).start();
}
