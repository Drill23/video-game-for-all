import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTROLLER_PROFILES,
  PAD_BIT,
  VGFA_PAD_PACKET_BYTES,
  decodePadPacket,
  encodePadPacket,
  type ConsoleId,
  type PadState,
} from '../src/index.js';

test('Codec binário VGFA-Pad empacota e decodifica DualShock 2 em exatamente 16 bytes', () => {
  const input: PadState = {
    slot: 2,
    buttons: PAD_BIT.UP | PAD_BIT.SOUTH | PAD_BIT.R2 | PAD_BIT.START,
    lx: -0.75,
    ly: 0.5,
    rx: 1.0,
    ry: -1.0,
    l2Pressure: 0.25,
    r2Pressure: 0.9,
    crossPressure: 0.65,
    squarePressure: 0.1,
    seq: 424242,
  };

  const encoded = encodePadPacket(input);
  assert.equal(encoded.byteLength, VGFA_PAD_PACKET_BYTES);

  const decoded = decodePadPacket(encoded);
  assert.ok(decoded !== null);
  assert.equal(decoded.slot, 2);
  assert.equal(decoded.buttons, input.buttons);
  assert.equal(decoded.seq, 424242);
  assert.ok(Math.abs(decoded.lx - input.lx) < 0.02);
  assert.ok(Math.abs(decoded.ly - input.ly) < 0.02);
  assert.ok(Math.abs(decoded.r2Pressure - input.r2Pressure) < 0.01);
  assert.ok(Math.abs(decoded.crossPressure - input.crossPressure) < 0.01);
});

test('decodePadPacket rejeita pacotes inválidos ou truncados', () => {
  assert.equal(decodePadPacket(new Uint8Array(8)), null);
  const badMagic = new Uint8Array(16);
  badMagic[0] = 0x00;
  assert.equal(decodePadPacket(badMagic), null);
});

test('Todos os 9 consoles (Atari 2600 até PS2) têm perfil de controle adaptativo completo', () => {
  const consoles: ConsoleId[] = [
    'atari2600',
    'nes',
    'snes',
    'megadrive',
    'gba',
    'n64',
    'ps1',
    'psp',
    'ps2',
  ];
  for (const id of consoles) {
    const p = CONTROLLER_PROFILES[id];
    assert.ok(p, `Perfil ausente para ${id}`);
    assert.ok(p.faceButtons.length >= 1, `${id} deve ter ao menos 1 botão de ação`);
  }
  assert.equal(CONTROLLER_PROFILES.ps2.hasPressureButtons, true);
  assert.equal(CONTROLLER_PROFILES.ps2.hasLeftStick, true);
  assert.equal(CONTROLLER_PROFILES.ps2.hasRightStick, true);
  assert.equal(CONTROLLER_PROFILES.atari2600.faceButtons.length, 1);
});

test('VGFA Link: pacote de 16 bytes atravessa o relé em base64 sem perdas', async () => {
  const { packetToBase64, base64ToPacket } = await import('../src/index.js');
  const packet = encodePadPacket({ ...createEmptyForTest(), buttons: PAD_BIT.START | PAD_BIT.EAST, lx: -1, seq: 77 });
  const back = base64ToPacket(packetToBase64(packet));
  assert.ok(back);
  const decoded = decodePadPacket(back!);
  assert.equal(decoded?.buttons, PAD_BIT.START | PAD_BIT.EAST);
  assert.equal(decoded?.seq, 77);
});

test('Bomba de estado reenvia o estado completo (botão nunca fica preso nem some)', async () => {
  const { PadStatePump } = await import('../src/index.js');
  const sent: Uint8Array[] = [];
  const pump = new PadStatePump({ mode: () => 'fast', sendFast: (p) => sent.push(p), sendSlow: () => {} });
  pump.setSlot(1);
  pump.start();
  pump.update({ ...createEmptyForTest(), buttons: PAD_BIT.SOUTH });
  await new Promise((r) => setTimeout(r, 160));
  pump.update({ ...createEmptyForTest(), buttons: 0 });
  pump.stop();
  assert.ok(sent.length >= 3, `esperava reenvios contínuos, veio ${sent.length}`);
  const states = sent.map((p) => decodePadPacket(p)!);
  assert.equal(states[0].buttons, PAD_BIT.SOUTH);
  assert.equal(states[0].slot, 1);
  assert.equal(states[states.length - 1].buttons, 0, 'o último pacote solta o botão');
  for (let i = 1; i < states.length; i++) assert.ok(states[i].seq > states[i - 1].seq);
});

function createEmptyForTest() {
  return { buttons: 0, lx: 0, ly: 0, rx: 0, ry: 0, l2Pressure: 0, r2Pressure: 0, crossPressure: 0, squarePressure: 0, slot: 0, seq: 0 };
}
