import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILTIN_CATALOG,
  CONSOLES,
  detectConsoleFromFilename,
  probePs2WebCapabilities,
} from '../src/index.js';

test('Catálogo de consoles cobre do Atari 2600 até o PlayStation 2', () => {
  const ids = CONSOLES.map((c) => c.id);
  assert.ok(ids.includes('atari2600'));
  assert.ok(ids.includes('nes'));
  assert.ok(ids.includes('snes'));
  assert.ok(ids.includes('megadrive'));
  assert.ok(ids.includes('gba'));
  assert.ok(ids.includes('n64'));
  assert.ok(ids.includes('ps1'));
  assert.ok(ids.includes('psp'));
  assert.ok(ids.includes('ps2'));
});

test('detectConsoleFromFilename identifica corretamente extensões retrô e PS2', () => {
  assert.equal(detectConsoleFromFilename('river_raid.a26'), 'atari2600');
  assert.equal(detectConsoleFromFilename('homebrew.nes'), 'nes');
  assert.equal(detectConsoleFromFilename('top_gear.sfc'), 'snes');
  assert.equal(detectConsoleFromFilename('sonic.md'), 'megadrive');
  assert.equal(detectConsoleFromFilename('advance.gba'), 'gba');
  assert.equal(detectConsoleFromFilename('kart.z64'), 'n64');
  assert.equal(detectConsoleFromFilename('game.zso'), 'ps2');
});

test('Catálogo embutido inclui jogos jogáveis imediatos e laboratório PS2', () => {
  assert.ok(BUILTIN_CATALOG.some((g) => g.mode === 'builtin-arcade' && g.consoleId === 'atari2600'));
  assert.ok(BUILTIN_CATALOG.some((g) => g.mode === 'builtin-arcade' && g.consoleId === 'ps2'));
  assert.ok(BUILTIN_CATALOG.some((g) => g.mode === 'ps2-webgpu-lab'));
});

test('probePs2WebCapabilities executa de forma segura fora do navegador', async () => {
  const caps = await probePs2WebCapabilities();
  assert.equal(typeof caps.readinessScore, 'number');
  assert.equal(typeof caps.wasmSimdSupported, 'boolean');
  assert.ok(Array.isArray(caps.notes));
});
