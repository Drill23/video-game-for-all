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
