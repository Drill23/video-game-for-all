import assert from 'node:assert/strict';
import test from 'node:test';
import { VgfaAuthStore, VgfaSaveStore } from '../src/index.js';

test('VgfaSaveStore salva, recupera e cria Memory Card PS2 de 8 MB', async () => {
  const store = new VgfaSaveStore();
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6]);

  const summary = await store.put({
    userId: 'u1',
    consoleId: 'snes',
    gameId: 'turbo-circuit',
    gameTitle: 'Turbo Circuit 16',
    kind: 'state',
    slot: 1,
    data: payload,
  });

  assert.equal(summary.sizeBytes, 6);
  const loaded = await store.get('u1', 'snes', 'turbo-circuit', 'state', 1);
  assert.ok(loaded);
  assert.deepEqual(Array.from(loaded.data), [1, 2, 3, 4, 5, 6]);

  const list = await store.listByUser('u1');
  assert.equal(list.length, 1);

  const mc = VgfaSaveStore.createBlankMemoryCard('memcard-ps2');
  assert.equal(mc.byteLength, 8 * 1024 * 1024);
  assert.equal(new TextDecoder().decode(mc.subarray(0, 19)), 'Sony PS2 Memory Car');
});

test('VgfaAuthStore registra, faz login, salva favoritos e idioma', () => {
  const auth = new VgfaAuthStore();
  const user = auth.register('Adriano', 'adriano@vgfa.dev', '123456');
  assert.equal(user.username, 'Adriano');

  auth.logout();
  assert.equal(auth.getCurrentUser(), null);

  const logged = auth.login('adriano@vgfa.dev', '123456');
  assert.equal(logged.id, user.id);

  const withFav = auth.toggleFavorite('star-drift-2600');
  assert.deepEqual(withFav?.favorites, ['star-drift-2600']);

  auth.setLanguage('en');
  assert.equal(auth.getLanguage(), 'en');
});
