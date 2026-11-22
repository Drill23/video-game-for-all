import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import WebSocket from 'ws';
import { PAD_BIT, decodePadPacket, encodePadPacket } from '@vgfa/pad';
import { createSignalingServer } from '../src/server.js';

function waitForJson(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout esperando mensagem WS')), 4000);
    const handler = (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

test('Signaling Server cria sala, pareia celular, troca skin ao vivo e encaminha pacote binário de 16 bytes', async () => {
  const srv = createSignalingServer(0);
  const port = await srv.start();

  try {
    const healthRes = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = (await healthRes.json()) as { ok: boolean; service: string };
    assert.equal(health.ok, true);
    assert.equal(health.service, 'vgfa-signaling');

    const netRes = await fetch(`http://127.0.0.1:${port}/api/network-info`);
    assert.equal(netRes.status, 200);
    const netInfo = (await netRes.json()) as { lanIp: string };
    assert.ok(netInfo.lanIp.length > 0);

    const host = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((r) => host.once('open', () => r()));

    const createdP = waitForJson(host, (m) => m.type === 'room:created');
    host.send(JSON.stringify({ type: 'host:create', consoleId: 'atari2600', gameTitle: 'Star Drift' }));
    const created = await createdP;
    const roomCode = String(created.roomCode);
    assert.match(roomCode, /^VGFA-[A-Z0-9]{4}$/);

    // Celular entra na sala
    const phone = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((r) => phone.once('open', () => r()));

    const phoneJoinedP = waitForJson(phone, (m) => m.type === 'room:joined');
    const hostNotifiedP = waitForJson(host, (m) => m.type === 'pad:joined');
    phone.send(JSON.stringify({ type: 'pad:join', roomCode, label: 'iPhone Teste' }));

    const phoneJoined = await phoneJoinedP;
    const hostNotified = await hostNotifiedP;
    assert.equal(phoneJoined.slot, 0);
    assert.equal(phoneJoined.consoleId, 'atari2600');
    assert.equal(hostNotified.slot, 0);

    // Host troca o console ao vivo para PS2 -> Celular recebe atualização de skin
    const consoleChangedP = waitForJson(phone, (m) => m.type === 'host:console');
    host.send(JSON.stringify({ type: 'host:console', consoleId: 'ps2', gameTitle: 'DualShock 2 Arena' }));
    const consoleChanged = await consoleChangedP;
    assert.equal(consoleChanged.consoleId, 'ps2');

    // Celular envia pacote binário DualShock 2 de 16 bytes -> Host recebe sem perda
    const binaryReceived = new Promise<Buffer>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout esperando pacote binário')), 3000);
      host.on('message', (data, isBinary) => {
        if (isBinary) {
          clearTimeout(t);
          resolve(Buffer.from(data as Buffer));
        }
      });
    });

    const packet = encodePadPacket({
      slot: 0,
      buttons: PAD_BIT.SOUTH | PAD_BIT.R2,
      lx: 0.5,
      ly: -0.5,
      rx: 0,
      ry: 0,
      l2Pressure: 0,
      r2Pressure: 0.8,
      crossPressure: 1,
      squarePressure: 0,
      seq: 7,
    });
    phone.send(packet, { binary: true });

    const raw = await binaryReceived;
    const decoded = decodePadPacket(new Uint8Array(raw));
    assert.ok(decoded);
    assert.equal(decoded.seq, 7);
    assert.equal(decoded.buttons, PAD_BIT.SOUTH | PAD_BIT.R2);
    assert.ok(decoded.r2Pressure > 0.75);

    phone.close();
    host.close();
  } finally {
    await srv.close();
  }
});

test('Proxy CORS-Free (/api/proxy/stream) repassa HTTP 206 Byte Ranges com headers CORP/CORS', async () => {
  // Mini servidor upstream simulando uma ISO remota com Range 206
  const payload = Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  const upstream = http.createServer((req, res) => {
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d+)/.exec(range);
      if (m) {
        const start = Number(m[1]);
        const end = Math.min(payload.length - 1, Number(m[2]));
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${payload.length}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
        });
        res.end(payload.subarray(start, end + 1));
        return;
      }
    }
    res.writeHead(200, { 'Content-Length': String(payload.length) });
    res.end(payload);
  });

  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
  const upPort = (upstream.address() as { port: number }).port;

  const srv = createSignalingServer(0);
  const proxyPort = await srv.start();

  try {
    const target = encodeURIComponent(`http://127.0.0.1:${upPort}/game.iso`);
    const res = await fetch(`http://127.0.0.1:${proxyPort}/api/proxy/stream?url=${target}`, {
      headers: { Range: 'bytes=10-15' },
    });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal(res.headers.get('content-range'), `bytes 10-15/${payload.length}`);
    assert.equal(await res.text(), 'ABCDEF');

    const tunnelRes = await fetch(`http://127.0.0.1:${proxyPort}/api/tunnel/status`);
    assert.equal(tunnelRes.status, 200);
    const tunnelJson = (await tunnelRes.json()) as { status: string };
    assert.equal(tunnelJson.status, 'stopped');
  } finally {
    await srv.close();
    await new Promise<void>((r) => upstream.close(() => r()));
  }
});

test('VGFA Hyper-Stream ativa cache NVMe 2 MiB + prefetch paralelo em ISOs > 4 MiB', async () => {
  // Simula uma ISO de 5 MiB com padrão determinístico
  const totalSize = 5 * 1024 * 1024;
  const isoBuf = Buffer.alloc(totalSize);
  for (let i = 0; i < totalSize; i += 4096) {
    isoBuf.writeUInt32BE(i, i);
  }
  let rangeHits = 0;
  const uniqueTag = `iso-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const upstream = http.createServer((req, res) => {
    const range = req.headers.range;
    const m = range ? /bytes=(\d+)-(\d+)/.exec(range) : null;
    if (m) {
      rangeHits++;
      const start = Number(m[1]);
      const end = Math.min(totalSize - 1, Number(m[2]));
      res.writeHead(206, {
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
      });
      res.end(isoBuf.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { 'Content-Length': String(totalSize) });
    res.end();
  });

  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
  const upPort = (upstream.address() as { port: number }).port;
  const srv = createSignalingServer(0);
  const proxyPort = await srv.start();

  try {
    const target = encodeURIComponent(`http://127.0.0.1:${upPort}/${uniqueTag}.iso`);
    const r1 = await fetch(`http://127.0.0.1:${proxyPort}/api/proxy/stream?url=${target}`, {
      headers: { Range: 'bytes=4096-8191' },
    });
    assert.equal(r1.status, 206);
    assert.equal(r1.headers.get('x-vgfa-hyperstream'), 'nvme-2mb-4x');
    const b1 = Buffer.from(await r1.arrayBuffer());
    assert.equal(b1.length, 4096);
    assert.equal(b1.readUInt32BE(0), 4096);

    // Espera os blocos em NVMe finalizarem e lê de novo sem bater na origem!
    await new Promise((r) => setTimeout(r, 120));
    const hitsBefore = rangeHits;
    const r2 = await fetch(`http://127.0.0.1:${proxyPort}/api/proxy/stream?url=${target}`, {
      headers: { Range: 'bytes=8192-12287' },
    });
    assert.equal(r2.status, 206);
    assert.equal(r2.headers.get('x-vgfa-hyperstream'), 'nvme-2mb-4x');
    const b2 = Buffer.from(await r2.arrayBuffer());
    assert.equal(b2.readUInt32BE(0), 8192);
    assert.equal(rangeHits, hitsBefore, '2ª leitura dentro do bloco 2 MiB deve vir direto do cache NVMe');
  } finally {
    await srv.close();
    await new Promise<void>((r) => upstream.close(() => r()));
  }
});

test('VGFA-Cast cria transmissão, pareia espectador remoto e encaminha SDP + controle binário 16 bytes', async () => {
  const srv = createSignalingServer(0);
  const port = await srv.start();
  try {
    const host = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((r) => host.once('open', () => r()));
    const createdP = waitForJson(host, (m) => m.type === 'cast:created');
    host.send(JSON.stringify({ type: 'cast:create', consoleId: 'ps2', gameTitle: 'God of War II' }));
    const created = await createdP;
    const castCode = String(created.castCode);
    assert.match(castCode, /^CAST-[A-Z0-9]{4}$/);

    const viewer = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((r) => viewer.once('open', () => r()));
    const joinedP = waitForJson(viewer, (m) => m.type === 'cast:joined');
    const hostViewerP = waitForJson(host, (m) => m.type === 'cast:viewer-joined');
    viewer.send(JSON.stringify({ type: 'cast:join', castCode, label: 'Amigo iPhone' }));
    const joined = await joinedP;
    const hostViewer = await hostViewerP;
    assert.equal(joined.gameTitle, 'God of War II');
    assert.equal(hostViewer.viewerId, joined.viewerId);

    const binaryP = new Promise<Buffer>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout cast binary')), 3000);
      host.on('message', (data, isBinary) => {
        if (isBinary) {
          clearTimeout(t);
          resolve(Buffer.from(data as Buffer));
        }
      });
    });
    viewer.send(
      encodePadPacket({
        slot: 0,
        buttons: PAD_BIT.START | PAD_BIT.SOUTH,
        lx: 0,
        ly: 0,
        rx: 0,
        ry: 0,
        l2Pressure: 0,
        r2Pressure: 0,
        crossPressure: 1,
        squarePressure: 0,
        seq: 42,
      }),
      { binary: true },
    );
    const decoded = decodePadPacket(new Uint8Array(await binaryP));
    assert.ok(decoded);
    assert.equal(decoded.seq, 42);
    assert.equal(decoded.buttons, PAD_BIT.START | PAD_BIT.SOUTH);

    viewer.close();
    host.close();
  } finally {
    await srv.close();
  }
});
