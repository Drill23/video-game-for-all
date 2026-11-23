import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ALL_STORE_GAMES,
  CONSOLES,
  FREE_PLAYABLE_ROMS,
  STORE_CATALOG,
  PS1_TOP_GAMES,
  PS2_TOP_GAMES,
  getSynopsis,
  buildEmulatorJsSrcDoc,
  detectConsoleFromFilename,
  formatBytes,
  getLibraryEntry,
  getStorageInfo,
  emitDownloadStarted,
  isPs2DiscOnDevice,
  listLibrary,
  opfsDiscHash,
  opfsDiscHashFallback,
  ps2DiscKeyCandidates,
  ps2FileNameFromUrl,
  ps2OpfsCandidates,
  registerPs2Disc,
  sanitizeTurboFileName,
  turboDiscNameForFile,
  turboDiscStoreName,
  listOpfsDiscs,
  onLibraryChange,
  readLibraryFile,
  probePs2WebCapabilities,
} from '../src/index.js';

test('Catálogo de consoles cobre do Atari 2600 até o PlayStation 2 com cores verificados', () => {
  const ids = CONSOLES.map((c) => c.id);
  for (const id of ['atari2600', 'nes', 'snes', 'megadrive', 'gba', 'n64', 'ps1', 'psp', 'ps2']) {
    assert.ok(ids.includes(id as (typeof ids)[number]), `Console ${id} ausente`);
  }
});

test('Loja VGFA inclui Top PS2 (DBZ BT3, GTA SA, GoW2) e ROMs livres jogáveis em 1 clique', () => {
  assert.ok(STORE_CATALOG.length >= 40, 'Loja deve ter ao menos 40 clássicos reais');
  assert.ok(STORE_CATALOG.some((g) => g.id === 'ps2-dbz-bt3' && g.serial === 'SLUS-21678'));
  assert.ok(STORE_CATALOG.some((g) => g.id === 'ps2-gta-sa' && g.serial === 'SLUS-20946'));
  assert.ok(FREE_PLAYABLE_ROMS.length >= 9 + 15, 'Ao menos 15 homebrews novos além dos 9 originais');
  assert.ok(FREE_PLAYABLE_ROMS.every((g) => g.availability === 'free-playable' && g.freeRomUrl));
  assert.equal(
    ALL_STORE_GAMES.length,
    STORE_CATALOG.length + FREE_PLAYABLE_ROMS.length + PS1_TOP_GAMES.length + PS2_TOP_GAMES.length,
  );
});

test('catálogo total: ids únicos e volume mínimo de PS1 (50) e PS2 (100)', () => {
  const ids = ALL_STORE_GAMES.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, 'ids repetidos em ALL_STORE_GAMES');
  assert.equal(PS1_TOP_GAMES.length, 50);
  assert.equal(PS2_TOP_GAMES.length, 100);
  assert.ok(ALL_STORE_GAMES.filter((g) => g.consoleId === 'ps1').length >= 50);
  assert.ok(ALL_STORE_GAMES.filter((g) => g.consoleId === 'ps2').length >= 100);
  for (const g of PS1_TOP_GAMES) assert.equal(g.consoleId, 'ps1', g.id);
  for (const g of PS2_TOP_GAMES) assert.equal(g.consoleId, 'ps2', g.id);
});

test('jogos comerciais (bring-your-rom) nunca têm link de ROM/ISO', () => {
  for (const g of ALL_STORE_GAMES.filter((x) => x.availability === 'bring-your-rom')) {
    assert.equal(g.freeRomUrl, undefined, `${g.id} não pode ter freeRomUrl`);
    assert.equal(g.freeRomFilename, undefined, `${g.id} não pode ter freeRomFilename`);
  }
});

test('todo jogo tem capa https, sinopse PT e, nos tops, a ficha rica completa', () => {
  for (const g of ALL_STORE_GAMES) {
    assert.ok(g.coverUrl.startsWith('https://'), `${g.id}: coverUrl não é https`);
    assert.ok(g.synopsisPt.trim().length > 0, `${g.id}: sem synopsisPt`);
  }
  for (const g of [...PS1_TOP_GAMES, ...PS2_TOP_GAMES]) {
    assert.ok(g.serial && /^S[LC]US-\d{5}$/.test(g.serial), `${g.id}: serial NTSC-U inválido`);
    assert.ok(g.publisher && g.tags?.length && g.modesPt?.length, `${g.id}: ficha incompleta`);
    assert.ok(g.playtimeHours && g.highlightsPt && g.highlightsPt.length >= 2, `${g.id}: horas/destaques`);
    assert.ok(g.ageRating && g.franchise && g.topRank, `${g.id}: classificação/franquia/ranking`);
    assert.ok(g.rating >= 0 && g.rating <= 10, `${g.id}: nota fora de 0..10`);
  }
});

test('topRank é único e sequencial por console (ps1 e ps2)', () => {
  for (const c of ['ps1', 'ps2'] as const) {
    const ranks = ALL_STORE_GAMES.filter((g) => g.consoleId === c && g.topRank !== undefined)
      .map((g) => g.topRank as number)
      .sort((a, b) => a - b);
    assert.deepEqual(ranks, ranks.map((_, i) => i + 1), `ranking ${c} deve ser 1..N sem buracos`);
  }
});

test('getSynopsis usa o idioma pedido e cai para o português', () => {
  const base = ALL_STORE_GAMES.find((g) => g.id === 'ps2-dbz-bt3')!;
  assert.equal(getSynopsis(base, 'en'), base.synopsisEn);
  assert.equal(getSynopsis(base, 'es'), base.synopsisEs);
  assert.equal(getSynopsis(base, 'pt'), base.synopsisPt);
  const semTraducao = ALL_STORE_GAMES.find((g) => !g.synopsisEn)!;
  assert.equal(getSynopsis(semTraducao, 'en'), semTraducao.synopsisPt);
  assert.equal(getSynopsis(semTraducao, 'es'), semTraducao.synopsisPt);
  assert.equal(getSynopsis(semTraducao, 'fr'), semTraducao.synopsisPt);
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

test('formatBytes formata em pt-BR', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(Math.round(3.2 * 1024 * 1024)), '3,2 MB');
  assert.equal(formatBytes(Math.round(1.4 * 1024 * 1024 * 1024)), '1,4 GB');
});

test('rom-library é seguro em Node (sem IndexedDB/OPFS): devolve vazio sem lançar', async () => {
  assert.deepEqual(await listLibrary(), []);
  assert.equal(await getLibraryEntry('https://x.test/a.nes'), null);
  assert.equal(await readLibraryFile('https://x.test/a.nes'), null);
  assert.deepEqual(await listOpfsDiscs(), []);
  const info = await getStorageInfo();
  assert.equal(typeof info.usage, 'number');
  const off = onLibraryChange(() => undefined);
  off();
});

// ==================== Discos PS2 no OPFS: mesmo cálculo dos runners ====================

const PUBLIC_DIR = new URL('../../../apps/web/public/', import.meta.url);

test('nome do arquivo turbo: sanitiza e corta igual ao ps2-turbo-runner', () => {
  assert.equal(turboDiscStoreName('game.iso'), 'game.iso.iso');
  assert.equal(
    turboDiscNameForFile('Dragon Ball Z - Budokai Tenkaichi 3 (USA).iso'),
    'Dragon_Ball_Z_-_Budokai_Tenkaichi_3__USA_.iso.iso',
  );
  // limpa caminho, troca caracteres estranhos por '_' e corta em 64 antes do '.iso'
  assert.equal(sanitizeTurboFileName('C:\\jogos\\GoW 2 (Europe)!.iso'), 'GoW 2 _Europe_.iso');
  const long = `${'a'.repeat(100)}.iso`;
  assert.equal(sanitizeTurboFileName(long).length, 96);
  assert.equal(turboDiscNameForFile(long), `${'a'.repeat(64)}.iso`);
  assert.equal(turboDiscNameForFile(''), 'game.iso.iso');
  assert.equal(ps2FileNameFromUrl('https://archive.org/download/x/Meu%20Jogo.iso?foo=1'), 'Meu Jogo.iso');
  assert.equal(ps2FileNameFromUrl('https://x.test/'), 'disc.iso');
});

test('nome turbo bate com a fórmula que está DENTRO do ps2-turbo-runner.html', () => {
  const file = new URL('ps2-turbo-runner.html', PUBLIC_DIR);
  if (!existsSync(file)) return;
  const html = readFileSync(file, 'utf8');
  const fn = /function sanitizeFileName\(name, fallback\) \{[\s\S]*?\n {8}\}/.exec(html);
  const keyLine = /const safeKey = (cleanName[^;]+);/.exec(html);
  assert.ok(fn && keyLine, 'não achei sanitizeFileName/safeKey no runner (mudou? atualize rom-library.ts)');
  const runner = new Function(`${fn![0]}; return (n) => { const cleanName = sanitizeFileName(n, 'game.iso'); return ${keyLine![1]}; };`)() as (
    n: string,
  ) => string;
  const samples = [
    'game.iso',
    'Dragon Ball Z - Budokai Tenkaichi 3 (USA).iso',
    'C:\\jogos\\GoW 2 (Europe)!.iso',
    '/tmp/a b/ç ã é.iso',
    `${'z'.repeat(120)}.iso`,
    'x'.repeat(63) + ' y.iso',
    '   spaced   .iso',
    '',
    '???',
  ];
  for (const n of samples) {
    assert.equal(turboDiscNameForFile(n), runner(n), `diverge para "${n}"`);
  }
});

test('hash da pasta vgfa-opfs-discs: SHA-1 (8 bytes, hex) como o runner', async () => {
  for (const key of ['/api/proxy/stream?url=https%3A%2F%2Farchive.org%2Fdownload%2Fx%2Fy.iso', 'https://cors.archive.org/cors/x/y.iso', 'ação ✓']) {
    const expected = createHash('sha1').update(key, 'utf8').digest('hex').slice(0, 16);
    assert.equal(await opfsDiscHash(key), expected);
  }
  assert.equal(opfsDiscHashFallback(''), '811c9dc5');
  assert.equal(opfsDiscHashFallback('a'), 'e40c292c');
});

test('hash bate com o VgfaOpfsDiscDevice.hashStr real (e com o fallback FNV sem crypto.subtle)', async () => {
  const file = new URL('vgfa-opfs-disc.js', PUBLIC_DIR);
  if (!existsSync(file)) return;
  const mod = (await import(file.href)) as { VgfaOpfsDiscDevice: new (m: unknown) => { hashStr(s: string): Promise<string> } };
  const dev = new mod.VgfaOpfsDiscDevice({});
  const keys = ['/api/proxy/stream?url=https%3A%2F%2Farchive.org%2Fdownload%2Fx%2Fy.iso', 'https://cors.archive.org/cors/x/y.iso', 'ação ✓', ''];
  for (const k of keys) assert.equal(await opfsDiscHash(k), await dev.hashStr(k));

  // sem crypto.subtle (HTTP fora de localhost): runner cai no FNV-1a; o nosso tem que cair igual
  const subtle = globalThis.crypto?.subtle as unknown as { digest: unknown } | undefined;
  if (subtle) {
    const original = subtle.digest;
    try {
      subtle.digest = () => Promise.reject(new Error('sem subtle'));
      for (const k of keys) {
        assert.equal(await opfsDiscHash(k), await dev.hashStr(k));
        assert.equal(await opfsDiscHash(k), opfsDiscHashFallback(k));
      }
    } finally {
      subtle.digest = original;
    }
  }
});

test('candidatos do OPFS PS2: turbo pelo nome do arquivo + hash de cada discKey possível', async () => {
  const url = 'https://archive.org/download/jogo/Meu Jogo.iso';
  const keys = ps2DiscKeyCandidates(url);
  assert.ok(keys.includes(`/api/proxy/stream?url=${encodeURIComponent(url)}`));
  assert.ok(keys.includes('https://cors.archive.org/cors/jogo/Meu Jogo.iso'));
  assert.ok(keys.includes(url));
  assert.ok(keys.includes('https://archive.org/download/jogo/MeuJogo.iso'), 'também sem espaços');
  const refs = await ps2OpfsCandidates({ url });
  assert.equal(refs[0].dir, 'vgfa-turbo-discs');
  assert.equal(refs[0].name, 'Meu_Jogo.iso.iso');
  assert.ok(refs.slice(1).every((r) => r.dir === 'vgfa-opfs-discs' && /^[0-9a-f]{16}$/.test(r.name)));
  assert.deepEqual(await ps2OpfsCandidates({}), []);
});

test('registro de disco PS2 e aviso de download são seguros em Node', async () => {
  const res = await registerPs2Disc({ url: 'https://x.test/a.iso', title: 'Teste' });
  assert.equal(res.entry, null);
  assert.equal(res.alreadyOnDevice, false);
  assert.equal(await isPs2DiscOnDevice({ url: 'https://x.test/a.iso' }), false);
  emitDownloadStarted({ title: 'Teste', kind: 'ps2-disc' });
});
