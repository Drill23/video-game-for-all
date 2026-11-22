/**
 * "Minha Central" — biblioteca local de jogos.
 *
 * Os jogos baixados ficam guardados NO APARELHO de quem abriu o site (IndexedDB),
 * em pedaços de 8 MiB (Blob), para nunca montar centenas de MB na memória.
 * Também lista/apaga os discos PS2 que já ficam no OPFS.
 *
 * Seguro fora do navegador (Node/testes): sem `indexedDB`, tudo devolve vazio/null.
 */
import { buildProxyStreamUrl, detectVgfaBackend, toArchiveCorsUrl } from './archive-search.js';
import type { DownloadProgress } from './retro-engine.js';

export interface LibraryMeta {
  gameId?: string;
  title?: string;
  consoleId?: string;
  coverUrl?: string;
}

export interface LibraryEntry {
  /** URL normalizada (sem espaços). */
  key: string;
  url: string;
  filename: string;
  sizeBytes: number;
  chunkCount: number;
  savedAt: number;
  lastPlayedAt: number;
  complete: boolean;
  gameId?: string;
  title?: string;
  consoleId?: string;
  coverUrl?: string;
}

export interface OpfsDiscInfo {
  id: string;
  dir: 'vgfa-opfs-discs' | 'vgfa-disc-cache';
  name: string;
  sizeBytes: number;
}

const LIBRARY_DB = 'vgfa_library_v2';
const META_STORE = 'meta';
const CHUNK_STORE = 'chunks';
const CHUNK_BYTES = 8 * 1024 * 1024;
const LEGACY_DB = 'vgfa_rom_cache_v1';
const LEGACY_STORE = 'roms';
const OPFS_DIRS: Array<OpfsDiscInfo['dir']> = ['vgfa-opfs-discs', 'vgfa-disc-cache'];

/** Erro de gravação local (cota, modo privado...). Distingue de falha de rede. */
export class LibraryStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryStorageError';
  }
}

// ==================== Utilidades ====================

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  if (i === 0) return `${Math.round(value)} B`;
  const text = value.toFixed(1).replace('.', ',');
  return `${text.endsWith(',0') ? text.slice(0, -2) : text} ${units[i]}`;
}

function normalizeKey(url: string): string {
  return String(url ?? '').replace(/\s+/g, '');
}

function filenameFromUrl(url: string): string {
  try {
    const last = url.split('?')[0].split('#')[0].split('/').pop() || '';
    return decodeURIComponent(last) || 'rom.bin';
  } catch {
    return 'rom.bin';
  }
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function reqP<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Falha no armazenamento local.'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Falha no armazenamento local.'));
    tx.onabort = () => reject(tx.error ?? new Error('Gravação cancelada pelo navegador.'));
  });
}

// ==================== Avisos de mudança ====================

const localBus: EventTarget | null = typeof EventTarget !== 'undefined' ? new EventTarget() : null;
let channel: BroadcastChannel | null = null;
let channelTried = false;

function getChannel(): BroadcastChannel | null {
  if (channelTried) return channel;
  channelTried = true;
  // Só em contexto com IndexedDB (navegador): em Node o canal seguraria o processo vivo.
  if (!hasIndexedDb() || typeof BroadcastChannel === 'undefined') return null;
  try {
    channel = new BroadcastChannel('vgfa-library');
    (channel as unknown as { unref?: () => void }).unref?.();
    channel.onmessage = () => {
      try {
        localBus?.dispatchEvent(new Event('change'));
      } catch {
        // ignora
      }
    };
  } catch {
    channel = null;
  }
  return channel;
}

function emitChange(): void {
  try {
    localBus?.dispatchEvent(new Event('change'));
  } catch {
    // ignora
  }
  try {
    getChannel()?.postMessage('change');
  } catch {
    // ignora
  }
}

/** Chama `cb` depois de gravar/apagar (nesta aba ou em outras). Devolve a função de cancelar. */
export function onLibraryChange(cb: () => void): () => void {
  if (!localBus) return () => undefined;
  getChannel();
  const handler = () => cb();
  localBus.addEventListener('change', handler);
  return () => localBus.removeEventListener('change', handler);
}

// ==================== Banco local ====================

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openLibraryDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  const p = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(LIBRARY_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(CHUNK_STORE)) db.createObjectStore(CHUNK_STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        const reset = () => {
          if (dbPromise === p) dbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          reset();
        };
        db.onclose = reset;
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  dbPromise = p;
  void p.then((db) => {
    if (!db && dbPromise === p) dbPromise = null;
  });
  return p;
}

function chunkRange(key: string): IDBKeyRange {
  return IDBKeyRange.bound([key, -Infinity], [key, Infinity]);
}

async function putChunk(db: IDBDatabase, key: string, index: number, blob: Blob): Promise<void> {
  try {
    const tx = db.transaction(CHUNK_STORE, 'readwrite');
    tx.objectStore(CHUNK_STORE).put(blob, [key, index]);
    await txDone(tx);
  } catch (err) {
    throw new LibraryStorageError(describeStorageError(err));
  }
}

async function deleteChunks(db: IDBDatabase, key: string): Promise<void> {
  try {
    const tx = db.transaction(CHUNK_STORE, 'readwrite');
    tx.objectStore(CHUNK_STORE).delete(chunkRange(key));
    await txDone(tx);
  } catch {
    // limpeza é melhor-esforço
  }
}

async function readChunks(db: IDBDatabase, key: string, expected?: number): Promise<Blob[] | null> {
  try {
    const tx = db.transaction(CHUNK_STORE, 'readonly');
    const blobs = (await reqP(tx.objectStore(CHUNK_STORE).getAll(chunkRange(key)))) as Blob[];
    if (expected !== undefined && blobs.length !== expected) return null;
    return blobs;
  } catch {
    return null;
  }
}

function describeStorageError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError') return 'Sem espaço neste aparelho para guardar o jogo.';
  const msg = err instanceof Error ? err.message : '';
  return msg ? `Não foi possível guardar o jogo neste aparelho (${msg}).` : 'Não foi possível guardar o jogo neste aparelho.';
}

// ==================== Leitura ====================

export async function getLibraryEntry(url: string): Promise<LibraryEntry | null> {
  const db = await openLibraryDb();
  if (!db) return null;
  try {
    const tx = db.transaction(META_STORE, 'readonly');
    const entry = (await reqP(tx.objectStore(META_STORE).get(normalizeKey(url)))) as LibraryEntry | undefined;
    return entry && entry.complete ? entry : null;
  } catch {
    return null;
  }
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  const db = await openLibraryDb();
  if (!db) return [];
  try {
    const tx = db.transaction(META_STORE, 'readonly');
    const all = (await reqP(tx.objectStore(META_STORE).getAll())) as LibraryEntry[];
    return all.filter((e) => e && e.complete).sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  } catch {
    return [];
  }
}

export async function readLibraryFile(url: string): Promise<File | null> {
  const db = await openLibraryDb();
  if (!db) return null;
  const key = normalizeKey(url);
  const entry = await getLibraryEntry(url);
  if (entry) {
    const blobs = await readChunks(db, key, entry.chunkCount);
    if (blobs && blobs.length > 0) {
      return new File(blobs, entry.filename, { type: 'application/octet-stream' });
    }
    // registro quebrado (pedaços sumiram): limpa para baixar de novo
    await deleteLibraryEntry(url);
  }
  return migrateLegacyRom(db, url);
}

// ==================== Migração do cache antigo ====================

function openLegacyDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(LEGACY_DB, 1);
      req.onupgradeneeded = (ev) => {
        // banco não existia: não cria nada
        if ((ev as IDBVersionChangeEvent).oldVersion === 0) {
          try {
            req.transaction?.abort();
          } catch {
            // ignora
          }
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(LEGACY_STORE)) {
          db.close();
          resolve(null);
        } else {
          resolve(db);
        }
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function migrateLegacyRom(db: IDBDatabase, url: string): Promise<File | null> {
  const legacy = await openLegacyDb();
  if (!legacy) return null;
  try {
    let value: unknown;
    try {
      value = await reqP(legacy.transaction(LEGACY_STORE, 'readonly').objectStore(LEGACY_STORE).get(url));
    } catch {
      return null;
    }
    const bytes =
      value instanceof Uint8Array
        ? value
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : null;
    if (!bytes || bytes.byteLength === 0) return null;

    const key = normalizeKey(url);
    const filename = filenameFromUrl(url);
    const blobs: Blob[] = [];
    try {
      await deleteChunks(db, key);
      for (let off = 0, i = 0; off < bytes.byteLength; off += CHUNK_BYTES, i += 1) {
        const blob = new Blob([bytes.subarray(off, Math.min(off + CHUNK_BYTES, bytes.byteLength)) as BlobPart]);
        await putChunk(db, key, i, blob);
        blobs.push(blob);
      }
      const now = Date.now();
      const entry: LibraryEntry = {
        key,
        url: key,
        filename,
        sizeBytes: bytes.byteLength,
        chunkCount: blobs.length,
        savedAt: now,
        lastPlayedAt: now,
        complete: true,
      };
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).put(entry);
      await txDone(tx);
    } catch {
      await deleteChunks(db, key);
      // não conseguiu migrar; ainda assim entrega o jogo
      return new File([bytes as BlobPart], filename, { type: 'application/octet-stream' });
    }

    try {
      const tx = legacy.transaction(LEGACY_STORE, 'readwrite');
      tx.objectStore(LEGACY_STORE).delete(url);
      await txDone(tx);
    } catch {
      // ignora
    }
    emitChange();
    return new File(blobs, filename, { type: 'application/octet-stream' });
  } finally {
    legacy.close();
  }
}

// ==================== Download para a biblioteca ====================

async function putMeta(db: IDBDatabase, entry: LibraryEntry): Promise<void> {
  try {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put(entry);
    await txDone(tx);
  } catch (err) {
    throw new LibraryStorageError(describeStorageError(err));
  }
}

async function checkFreeSpace(needed: number): Promise<void> {
  if (needed <= 0) return;
  try {
    const est = await navigator.storage?.estimate?.();
    const quota = est?.quota ?? 0;
    if (quota > 0) {
      const free = Math.max(0, quota - (est?.usage ?? 0));
      if (needed > free) {
        throw new LibraryStorageError(
          `Espaço insuficiente neste aparelho: o jogo precisa de ${formatBytes(needed)} e há ${formatBytes(free)} livres.`,
        );
      }
    }
  } catch (err) {
    if (err instanceof LibraryStorageError) throw err;
    // estimate indisponível: segue em frente
  }
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || (err as { name?: string } | null)?.name === 'AbortError';
}

export interface DownloadToLibraryOptions {
  onProgress?: (p: DownloadProgress) => void;
  signal?: AbortSignal;
  meta?: LibraryMeta;
  /**
   * Se não der para gravar no aparelho (cota, Safari privado), continua o download
   * na memória e devolve o File mesmo assim, sem guardar. Padrão: false (lança erro).
   */
  fallbackToMemory?: boolean;
}

/**
 * Baixa em stream (proxy CORS) e grava em pedaços de 8 MiB na biblioteca.
 * Se abortar ou falhar, apaga os pedaços parciais.
 */
export async function downloadToLibrary(
  url: string,
  filename: string,
  opts: DownloadToLibraryOptions = {},
): Promise<File> {
  const { onProgress, signal, meta, fallbackToMemory = false } = opts;
  const key = normalizeKey(url);
  const isHttp = key.startsWith('http://') || key.startsWith('https://');
  // Espera saber se existe servidor próprio (no GitHub Pages não existe /api/proxy)
  if (isHttp) {
    try {
      await detectVgfaBackend();
    } catch {
      // segue com o link direto
    }
  }
  const fetchUrl = isHttp ? buildProxyStreamUrl(key) : key;

  let res: Response;
  try {
    res = await globalThis.fetch(fetchUrl, { signal });
    if (!res.ok && isHttp && fetchUrl !== toArchiveCorsUrl(key)) {
      // proxy indisponível: tenta direto na fonte (CORS)
      res = await globalThis.fetch(toArchiveCorsUrl(key), { signal });
    }
  } catch (err) {
    if (signal?.aborted || !isHttp || fetchUrl === toArchiveCorsUrl(key)) throw err;
    res = await globalThis.fetch(toArchiveCorsUrl(key), { signal });
  }
  if (!res.ok) {
    let detail = `Erro HTTP ${res.status}`;
    try {
      const errJson = (await res.json()) as { error?: string };
      if (errJson.error) detail = errJson.error;
    } catch {
      // ignora
    }
    throw new Error(detail);
  }

  const totalBytes = Number(res.headers.get('content-length') || 0);
  const db = await openLibraryDb();

  // Estado de gravação: `persist` vira false se o aparelho não deixar guardar.
  let persist = !!db;
  let storageError: LibraryStorageError | null = db
    ? null
    : new LibraryStorageError('Armazenamento local indisponível neste navegador.');
  if (db) {
    try {
      await checkFreeSpace(totalBytes);
    } catch (err) {
      persist = false;
      storageError = err as LibraryStorageError;
    }
  }
  if (!persist && !fallbackToMemory) {
    try {
      await res.body?.cancel();
    } catch {
      // ignora
    }
    throw storageError ?? new LibraryStorageError('Não foi possível guardar o jogo neste aparelho.');
  }

  let memBlobs: Blob[] = [];
  let index = 0;
  let loadedBytes = 0;
  let lastReport = 0;

  const report = (force = false) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastReport < 120) return;
    lastReport = now;
    const percent = totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 50;
    onProgress({ loadedBytes, totalBytes, percent });
  };

  const cleanup = async () => {
    if (db && persist) await deleteChunks(db, key);
  };

  /** Grava (ou guarda na memória) um pedaço pronto. */
  const flush = async (blob: Blob) => {
    if (persist && db) {
      try {
        await putChunk(db, key, index, blob);
        index += 1;
        return;
      } catch (err) {
        if (!fallbackToMemory) throw err;
        // passa para a memória: recupera o que já foi gravado (Blobs apoiados em disco)
        const saved = index > 0 ? await readChunks(db, key, index) : [];
        await deleteChunks(db, key);
        persist = false;
        if (!saved) throw err;
        memBlobs = saved;
      }
    }
    memBlobs.push(blob);
    index += 1;
  };

  try {
    if (!res.body) {
      const whole = await res.blob();
      loadedBytes = whole.size;
      for (let off = 0; off < whole.size; off += CHUNK_BYTES) {
        await flush(whole.slice(off, Math.min(off + CHUNK_BYTES, whole.size)));
      }
    } else {
      const reader = res.body.getReader();
      let parts: Uint8Array[] = [];
      let partBytes = 0;
      while (true) {
        if (signal?.aborted) throw new DOMException('Download cancelado.', 'AbortError');
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        parts.push(value);
        partBytes += value.byteLength;
        loadedBytes += value.byteLength;
        if (partBytes >= CHUNK_BYTES) {
          const blob = new Blob(parts as BlobPart[], { type: 'application/octet-stream' });
          parts = [];
          partBytes = 0;
          await flush(blob);
        }
        report();
      }
      if (partBytes > 0) await flush(new Blob(parts as BlobPart[], { type: 'application/octet-stream' }));
    }

    if (loadedBytes === 0) throw new Error('O servidor devolveu um arquivo vazio.');
    if (totalBytes > 0 && loadedBytes < totalBytes) throw new Error('Download incompleto. Tente de novo.');

    if (persist && db) {
      const now = Date.now();
      const entry: LibraryEntry = {
        key,
        url: key,
        filename,
        sizeBytes: loadedBytes,
        chunkCount: index,
        savedAt: now,
        lastPlayedAt: now,
        complete: true,
        ...cleanMeta(meta),
      };
      try {
        await putMeta(db, entry);
      } catch (err) {
        if (!fallbackToMemory) throw err;
        const saved = await readChunks(db, key, index);
        await deleteChunks(db, key);
        persist = false;
        if (!saved) throw err;
        memBlobs = saved;
      }
    }

    report(true);
    if (persist && db) {
      emitChange();
      const blobs = (await readChunks(db, key, index)) ?? null;
      if (blobs) return new File(blobs, filename, { type: 'application/octet-stream' });
      // leitura de volta falhou (raro): refaz o File pelo caminho normal
      const file = await readLibraryFile(key);
      if (file) return file;
      throw new LibraryStorageError('Não foi possível ler o jogo guardado.');
    }
    return new File(memBlobs, filename, { type: 'application/octet-stream' });
  } catch (err) {
    await cleanup();
    if (isAbort(err, signal)) {
      throw err instanceof Error ? err : new DOMException('Download cancelado.', 'AbortError');
    }
    throw err;
  }
}

function cleanMeta(meta?: LibraryMeta): LibraryMeta {
  const out: LibraryMeta = {};
  if (!meta) return out;
  if (meta.gameId) out.gameId = meta.gameId;
  if (meta.title) out.title = meta.title;
  if (meta.consoleId) out.consoleId = meta.consoleId;
  if (meta.coverUrl) out.coverUrl = meta.coverUrl;
  return out;
}

// ==================== Atualizar / apagar ====================

export async function markPlayed(url: string, meta?: LibraryMeta): Promise<void> {
  const db = await openLibraryDb();
  if (!db) return;
  try {
    const key = normalizeKey(url);
    const tx = db.transaction(META_STORE, 'readwrite');
    const store = tx.objectStore(META_STORE);
    const entry = (await reqP(store.get(key))) as LibraryEntry | undefined;
    if (!entry || !entry.complete) return;
    store.put({ ...entry, ...cleanMeta(meta), lastPlayedAt: Date.now() });
    await txDone(tx);
    emitChange();
  } catch {
    // não é crítico
  }
}

export async function deleteLibraryEntry(url: string): Promise<void> {
  const db = await openLibraryDb();
  if (!db) return;
  try {
    const key = normalizeKey(url);
    const tx = db.transaction([META_STORE, CHUNK_STORE], 'readwrite');
    tx.objectStore(META_STORE).delete(key);
    tx.objectStore(CHUNK_STORE).delete(chunkRange(key));
    await txDone(tx);
    emitChange();
  } catch {
    // ignora
  }
}

export async function clearLibrary(): Promise<void> {
  const db = await openLibraryDb();
  if (db) {
    try {
      const tx = db.transaction([META_STORE, CHUNK_STORE], 'readwrite');
      tx.objectStore(META_STORE).clear();
      tx.objectStore(CHUNK_STORE).clear();
      await txDone(tx);
    } catch {
      // ignora
    }
  }
  if (hasIndexedDb()) {
    try {
      indexedDB.deleteDatabase(LEGACY_DB);
    } catch {
      // ignora
    }
  }
  emitChange();
}

// ==================== Espaço do aparelho ====================

export async function getStorageInfo(): Promise<{ usage: number; quota: number; persisted: boolean }> {
  let usage = 0;
  let quota = 0;
  let persisted = false;
  try {
    const est = await navigator.storage?.estimate?.();
    usage = est?.usage ?? 0;
    quota = est?.quota ?? 0;
  } catch {
    // ignora
  }
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    // ignora
  }
  return { usage, quota, persisted };
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

// ==================== Discos PS2 no OPFS ====================

type DirHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

async function getOpfsRoot(): Promise<DirHandle | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
    return (await navigator.storage.getDirectory()) as DirHandle;
  } catch {
    return null;
  }
}

async function dirSize(handle: DirHandle): Promise<number> {
  let total = 0;
  try {
    for await (const [, child] of handle.entries()) {
      try {
        if (child.kind === 'file') {
          total += (await (child as FileSystemFileHandle).getFile()).size;
        } else {
          total += await dirSize(child as DirHandle);
        }
      } catch {
        // arquivo em uso/ilegível: ignora
      }
    }
  } catch {
    // ignora
  }
  return total;
}

export async function listOpfsDiscs(): Promise<OpfsDiscInfo[]> {
  const root = await getOpfsRoot();
  if (!root) return [];
  const out: OpfsDiscInfo[] = [];
  for (const dir of OPFS_DIRS) {
    try {
      const dirHandle = (await root.getDirectoryHandle(dir)) as DirHandle;
      for await (const [name, child] of dirHandle.entries()) {
        let sizeBytes = 0;
        try {
          sizeBytes =
            child.kind === 'file'
              ? (await (child as FileSystemFileHandle).getFile()).size
              : await dirSize(child as DirHandle);
        } catch {
          // ignora
        }
        out.push({ id: name, dir, name, sizeBytes });
      }
    } catch {
      // pasta não existe: nada a listar
    }
  }
  return out;
}

export async function deleteOpfsDisc(dir: OpfsDiscInfo['dir'], name: string): Promise<boolean> {
  const root = await getOpfsRoot();
  if (!root) return false;
  try {
    const dirHandle = await root.getDirectoryHandle(dir);
    await dirHandle.removeEntry(name, { recursive: true });
    emitChange();
    return true;
  } catch {
    return false;
  }
}
