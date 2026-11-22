import assert from 'node:assert/strict';
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
