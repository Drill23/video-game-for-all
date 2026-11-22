import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_STORE_GAMES,
  CONSOLES,
  FREE_PLAYABLE_ROMS,
  STORE_CATALOG,
  buildEmulatorJsSrcDoc,
  detectConsoleFromFilename,
  probePs2WebCapabilities,
} from '../src/index.js';

test('Catálogo de consoles cobre do Atari 2600 até o PlayStation 2 com cores verificados', () => {
  const ids = CONSOLES.map((c) => c.id);
  for (const id of ['atari2600', 'nes', 'snes', 'megadrive', 'gba', 'n64', 'ps1', 'psp', 'ps2']) {
    assert.ok(ids.includes(id as (typeof ids)[number]), `Console ${id} ausente`);
  }
});

test('Loja VGFA inclui Top PS2 (DBZ BT3, GTA SA, GoW2) e 9 ROMs livres jogáveis em 1 clique', () => {
  assert.ok(STORE_CATALOG.length >= 40, 'Loja deve ter ao menos 40 clássicos reais');
  assert.ok(STORE_CATALOG.some((g) => g.id === 'ps2-dbz-bt3' && g.serial === 'SLUS-21678'));
  assert.ok(STORE_CATALOG.some((g) => g.id === 'ps2-gta-sa' && g.serial === 'SLUS-20946'));
  assert.equal(FREE_PLAYABLE_ROMS.length, 9);
  assert.equal(ALL_STORE_GAMES.length, STORE_CATALOG.length + FREE_PLAYABLE_ROMS.length);
});

test('detectConsoleFromFilename identifica extensões retrô, PSP e PS2 corretamente', () => {
  assert.equal(detectConsoleFromFilename('river_raid.a26'), 'atari2600');
  assert.equal(detectConsoleFromFilename('homebrew.nes'), 'nes');
  assert.equal(detectConsoleFromFilename('top_gear.sfc'), 'snes');
  assert.equal(detectConsoleFromFilename('sonic.md'), 'megadrive');
  assert.equal(detectConsoleFromFilename('emerald.gba'), 'gba');
  assert.equal(detectConsoleFromFilename('kart.z64'), 'n64');
  assert.equal(detectConsoleFromFilename('DBZ_BT3_PS2_SLUS-21678.iso', 'atari2600'), 'ps2');
});

test('buildEmulatorJsSrcDoc gera runner válido para Atari 2600, N64 e PSP', () => {
  const html = buildEmulatorJsSrcDoc({
    system: 'psp',
    romBlobUrl: 'blob:http://localhost:5173/test',
    gameTitle: 'GTA VCS',
  });
  assert.ok(html.includes('https://cdn.emulatorjs.org/stable/data/loader.js'));
  assert.ok(html.includes('window.EJS_threads = true'));
});

test('probePs2WebCapabilities executa de forma segura fora do navegador', async () => {
  const caps = await probePs2WebCapabilities();
  assert.equal(typeof caps.readinessScore, 'number');
  assert.equal(typeof caps.wasmSimdSupported, 'boolean');
});
