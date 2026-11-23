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
import { ALL_STORE_GAMES } from './store-catalog.js';
import { listUserSources } from './user-sources.js';

export interface LibraryMeta {
  gameId?: string;
  title?: string;
  consoleId?: string;
  coverUrl?: string;
}

/** Pastas do OPFS onde os runners de PS2 guardam discos. NUNCA renomear. */
export type Ps2OpfsDir = 'vgfa-opfs-discs' | 'vgfa-turbo-discs' | 'vgfa-disc-cache';

export interface Ps2OpfsRef {
  dir: Ps2OpfsDir;
  name: string;
}

/** Como o disco está guardado: inteiro, baixando (incompleto) ou só o que já foi lido (streaming). */
export type Ps2DiscStorage = 'full' | 'partial' | 'streaming';

export interface LibraryEntry {
  /** URL normalizada (sem espaços). Para disco PS2 sem URL: `ps2:<gameId|arquivo>`. */
  key: string;
  url: string;
  filename: string;
  /** ROM: tamanho gravado no IndexedDB. Disco PS2: tamanho medido no OPFS. */
  sizeBytes: number;
  chunkCount: number;
  savedAt: number;
  lastPlayedAt: number;
  complete: boolean;
  gameId?: string;
  title?: string;
  consoleId?: string;
  coverUrl?: string;
  /** Ausente = 'rom'. 'ps2-disc' guarda só metadados; o disco em si fica no OPFS. */
  kind?: 'rom' | 'ps2-disc';
  /** Só PS2: onde o disco está no OPFS. */
  opfsRef?: Ps2OpfsRef;
  /** Só PS2: serial do disco (ex.: SLUS-21678). */
  serial?: string;
  /** Só PS2: como o disco está guardado (medido na listagem). */
  storage?: Ps2DiscStorage;
}

export interface OpfsDiscInfo {
  /** `${dir}/${name}` */
  id: string;
  dir: Ps2OpfsDir;
  name: string;
  sizeBytes: number;
  /** Nome amigável pronto para mostrar ("Disco PS2 · nome.iso"). */
  label: string;
  storage: Ps2DiscStorage;
  /** Nome do .iso quando dá para saber (pasta vgfa-turbo-discs). */
  fileName?: string;
  /** Nome do volume lido do próprio disco (ISO-9660), quando legível. */
  volumeId?: string;
  /** Preenchidos quando o disco foi reconhecido. */
  gameId?: string;
  title?: string;
  url?: string;
  coverUrl?: string;
  consoleId?: string;
  recognizedBy?: 'library' | 'user-source' | 'catalog' | 'file-name' | 'volume-id';
}

const LIBRARY_DB = 'vgfa_library_v2';
const META_STORE = 'meta';
const CHUNK_STORE = 'chunks';
const CHUNK_BYTES = 8 * 1024 * 1024;
const LEGACY_DB = 'vgfa_rom_cache_v1';
const LEGACY_STORE = 'roms';
const OPFS_DIRS: Ps2OpfsDir[] = ['vgfa-opfs-discs', 'vgfa-turbo-discs', 'vgfa-disc-cache'];
/** Evento disparado quando um jogo NOVO começa a ser guardado neste aparelho. */
export const VGFA_DOWNLOAD_STARTED_EVENT = 'vgfa:download-started';

export interface DownloadStartedInfo {
  title: string;
  consoleId?: string;
  coverUrl?: string;
  totalBytes?: number;
  kind: 'rom' | 'ps2-disc';
}

/**
 * Avisa a interface (sem acoplar React) que um jogo novo começou a ser guardado.
 * Quem escuta: `DownloadExplainerHost` (apps/web). Fora do navegador não faz nada.
 */
export function emitDownloadStarted(info: DownloadStartedInfo): void {
  try {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent<DownloadStartedInfo>(VGFA_DOWNLOAD_STARTED_EVENT, { detail: info }));
  } catch {
    // aviso é só cortesia: nunca atrapalha o download
  }
}

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
      invalidateOpfsMeasure();
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
  invalidateOpfsMeasure();
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
    // Disco PS2 não tem pedaços no IndexedDB: nunca devolve como ROM (evita "limpar registro quebrado").
    return entry && entry.complete && entry.kind !== 'ps2-disc' ? entry : null;
  } catch {
    return null;
  }
}

/**
 * Tudo que está guardado neste aparelho: ROMs (IndexedDB) e discos PS2 (OPFS).
 * Discos PS2 só aparecem se houver algo realmente gravado no OPFS; o `sizeBytes` deles é medido lá.
 */
export async function listLibrary(): Promise<LibraryEntry[]> {
  const db = await openLibraryDb();
  if (!db) return [];
  try {
    const tx = db.transaction(META_STORE, 'readonly');
    const all = ((await reqP(tx.objectStore(META_STORE).getAll())) as LibraryEntry[]).filter((e) => e && e.complete);
    const roms = all.filter((e) => e.kind !== 'ps2-disc');
    const ps2Meta = all.filter((e) => e.kind === 'ps2-disc');
    const ps2: LibraryEntry[] = [];
    for (const meta of ps2Meta) {
      try {
        const found = await resolvePs2Entry(meta);
        if (found) ps2.push(found);
      } catch {
        // disco ilegível agora: não aparece, mas os metadados continuam guardados
      }
    }
    return [...roms, ...ps2].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
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

  // Jogo NOVO sendo guardado neste aparelho (não é leitura do cache): avisa a interface.
  if (persist) {
    emitDownloadStarted({
      title: meta?.title || filename,
      consoleId: meta?.consoleId,
      coverUrl: meta?.coverUrl,
      totalBytes: totalBytes > 0 ? totalBytes : undefined,
      kind: 'rom',
    });
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

/**
 * Apaga um item da biblioteca. Para 'ps2-disc' apaga SÓ o arquivo/pasta daquele disco no OPFS
 * (e os metadados). Só deve ser chamado depois de a pessoa confirmar na interface.
 * Devolve false se o disco PS2 não pôde ser removido (em uso): os metadados ficam.
 */
export async function removeLibraryEntry(url: string): Promise<boolean> {
  const db = await openLibraryDb();
  if (!db) return false;
  try {
    const key = normalizeKey(url);
    const entry = (await reqP(db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(key))) as
      | LibraryEntry
      | undefined;
    if (entry?.kind === 'ps2-disc') {
      const ok = await deletePs2DiscFiles(entry);
      if (!ok) return false;
    }
    const tx = db.transaction([META_STORE, CHUNK_STORE], 'readwrite');
    tx.objectStore(META_STORE).delete(key);
    tx.objectStore(CHUNK_STORE).delete(chunkRange(key));
    await txDone(tx);
    emitChange();
    return true;
  } catch {
    return false;
  }
}

/** Igual a `removeLibraryEntry`, sem devolver nada (assinatura antiga, usada por botões que ignoram o resultado). */
export async function deleteLibraryEntry(url: string): Promise<void> {
  await removeLibraryEntry(url);
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
//
// Quem grava (arquivos em apps/web/public — só leitura aqui, nada é movido nem renomeado):
//  - vgfa-opfs-discs/<hash>/   (vgfa-opfs-disc.js, motor "Instantâneo"/Play.wasm)
//        hash = 8 primeiros bytes do SHA-1 (hex) da `discKey` = a URL EXATA enviada ao runner
//        (Ps2LabPanel manda buildProxyStreamUrl(url) para http/https). Dentro: full_disc.iso,
//        full_disc.part ou pedaços N.chk.
//  - vgfa-turbo-discs/<nome>.iso (+ .part)  (ps2-turbo-runner.html, streamToOpfsFile)
//  - vgfa-disc-cache/<discId>/   (@vgfa/disc, cache de diagnóstico em pedaços)

type DirHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

/** Mesmo `sanitizeFileName` do ps2-turbo-runner.html. */
export function sanitizeTurboFileName(name: string, fallback = 'game.iso'): string {
  const base = String(name || fallback)
    .replace(/^.*[\\/]/, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .trim();
  return base.slice(0, 96) || fallback;
}

/**
 * Nome do arquivo gravado em `vgfa-turbo-discs/` a partir do nome limpo (cleanName) do runner:
 * [^A-Za-z0-9._-] vira '_', corta em 64 caracteres e acrescenta '.iso'
 * (mesma conta de `streamToOpfsFile` no ps2-turbo-runner.html).
 */
export function turboDiscStoreName(cleanName: string): string {
  return cleanName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 64) + '.iso';
}

/** Do nome do arquivo do jogo (como o Ps2LabPanel manda) ao nome gravado no OPFS turbo. */
export function turboDiscNameForFile(fileName: string): string {
  return turboDiscStoreName(sanitizeTurboFileName(fileName || 'game.iso', 'game.iso'));
}

/** Nome do arquivo que o Ps2LabPanel manda ao runner quando só há URL. */
export function ps2FileNameFromUrl(url: string): string {
  const last = url.split('/').pop()?.split('?')[0] || 'disc.iso';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Fallback FNV-1a de 32 bits usado pelo runner quando não há crypto.subtle. */
export function opfsDiscHashFallback(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Nome da pasta em `vgfa-opfs-discs/` para uma `discKey` (mesma conta de `hashStr` do vgfa-opfs-disc.js). */
export async function opfsDiscHash(discKey: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(discKey));
    return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return opfsDiscHashFallback(discKey);
  }
}

/**
 * Todas as `discKey` plausíveis de uma URL (depende do backend estar ou não detectado na hora do jogo).
 * Usa a URL do jeito que o Ps2LabPanel manda (só com trim) e também sem espaços.
 */
export function ps2DiscKeyCandidates(url: string): string[] {
  const bases = [...new Set([String(url ?? '').trim(), normalizeKey(url)])].filter(Boolean);
  const out = new Set<string>();
  const add = (v: string) => {
    if (v) out.add(v);
  };
  for (const clean of bases) {
    if (/^https?:\/\//i.test(clean)) {
      try {
        add(buildProxyStreamUrl(clean));
      } catch {
        // ignora
      }
      add(`/api/proxy/stream?url=${encodeURIComponent(clean)}`);
      add(toArchiveCorsUrl(clean));
    }
    add(clean);
  }
  return [...out];
}

/** Onde o disco desta URL/arquivo estaria no OPFS (candidatos; pode não existir nenhum). */
export async function ps2OpfsCandidates(info: { url?: string; fileName?: string }): Promise<Ps2OpfsRef[]> {
  const refs: Ps2OpfsRef[] = [];
  const seen = new Set<string>();
  const push = (ref: Ps2OpfsRef) => {
    const k = `${ref.dir}/${ref.name}`;
    if (!seen.has(k)) {
      seen.add(k);
      refs.push(ref);
    }
  };
  const url = (info.url ?? '').trim();
  const fileName = info.fileName || (url ? ps2FileNameFromUrl(url) : '');
  if (fileName) push({ dir: 'vgfa-turbo-discs', name: turboDiscNameForFile(fileName) });
  for (const key of ps2DiscKeyCandidates(url)) {
    push({ dir: 'vgfa-opfs-discs', name: await opfsDiscHash(key) });
  }
  return refs;
}

async function getOpfsRoot(): Promise<DirHandle | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
    return (await navigator.storage.getDirectory()) as DirHandle;
  } catch {
    return null;
  }
}

interface TreeScan {
  size: number;
  /** Nomes dos arquivos no nível de cima. */
  top: string[];
}

async function scanTree(handle: DirHandle, topLevel = true): Promise<TreeScan> {
  let size = 0;
  const top: string[] = [];
  try {
    for await (const [name, child] of handle.entries()) {
      if (topLevel) top.push(name);
      try {
        if (child.kind === 'file') {
          size += (await (child as FileSystemFileHandle).getFile()).size;
        } else {
          size += (await scanTree(child as DirHandle, false)).size;
        }
      } catch {
        // arquivo em uso/ilegível: ignora
      }
    }
  } catch {
    // ignora
  }
  return { size, top };
}

interface Measured {
  exists: boolean;
  sizeBytes: number;
  storage: Ps2DiscStorage;
}

const MEASURE_TTL_MS = 15_000;
const measureCache = new Map<string, { at: number; value: Measured }>();
const measureInflight = new Map<string, Promise<Measured>>();

function invalidateOpfsMeasure(): void {
  measureCache.clear();
  measureInflight.clear();
}

/** Mede o que há gravado em `ref` SEM criar nada (só leitura). */
async function measureOpfsRef(ref: Ps2OpfsRef, force = false): Promise<Measured> {
  const id = `${ref.dir}/${ref.name}`;
  const hit = measureCache.get(id);
  if (!force && hit && Date.now() - hit.at < MEASURE_TTL_MS) return hit.value;
  const pending = measureInflight.get(id);
  if (!force && pending) return pending;

  const job = (async (): Promise<Measured> => {
    const none: Measured = { exists: false, sizeBytes: 0, storage: 'streaming' };
    const root = await getOpfsRoot();
    if (!root) return none;
    let dirHandle: DirHandle;
    try {
      dirHandle = (await root.getDirectoryHandle(ref.dir)) as DirHandle;
    } catch {
      return none;
    }
    // 1) arquivo (vgfa-turbo-discs)
    try {
      const f = await (await dirHandle.getFileHandle(ref.name)).getFile();
      return { exists: f.size > 0, sizeBytes: f.size, storage: ref.name.endsWith('.part') ? 'partial' : 'full' };
    } catch {
      // não é arquivo (ou não existe)
    }
    // 2) pasta (vgfa-opfs-discs/<hash>, vgfa-disc-cache/<id>)
    try {
      const sub = (await dirHandle.getDirectoryHandle(ref.name)) as DirHandle;
      const scan = await scanTree(sub);
      const hasFull = scan.top.includes('full_disc.iso');
      const hasPart = scan.top.includes('full_disc.part');
      return {
        exists: scan.size > 0,
        sizeBytes: scan.size,
        storage: hasFull ? 'full' : hasPart ? 'partial' : 'streaming',
      };
    } catch {
      // não existe
    }
    // 3) turbo: só sobrou o .part
    if (ref.dir === 'vgfa-turbo-discs') {
      try {
        const f = await (await dirHandle.getFileHandle(`${ref.name}.part`)).getFile();
        return { exists: f.size > 0, sizeBytes: f.size, storage: 'partial' };
      } catch {
        // nada
      }
    }
    return none;
  })()
    .then((value) => {
      measureCache.set(id, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      measureInflight.delete(id);
    });
  measureInflight.set(id, job);
  return job;
}

/** Acha, entre o ref guardado e os candidatos, onde o disco realmente está gravado. */
async function locatePs2Disc(
  entry: Pick<LibraryEntry, 'url' | 'filename' | 'opfsRef'>,
): Promise<{ ref: Ps2OpfsRef; measured: Measured } | null> {
  const tried = new Set<string>();
  const refs: Ps2OpfsRef[] = [];
  if (entry.opfsRef) refs.push(entry.opfsRef);
  for (const c of await ps2OpfsCandidates({ url: entry.url, fileName: entry.filename })) refs.push(c);
  let best: { ref: Ps2OpfsRef; measured: Measured } | null = null;
  for (const ref of refs) {
    const k = `${ref.dir}/${ref.name}`;
    if (tried.has(k)) continue;
    tried.add(k);
    const measured = await measureOpfsRef(ref);
    if (measured.exists && (!best || measured.sizeBytes > best.measured.sizeBytes)) best = { ref, measured };
  }
  return best;
}

/** Entrada de disco PS2 com tamanho/local medidos no OPFS, ou null se não há nada gravado. */
async function resolvePs2Entry(meta: LibraryEntry): Promise<LibraryEntry | null> {
  const found = await locatePs2Disc(meta);
  if (!found) return null;
  return {
    ...meta,
    kind: 'ps2-disc',
    opfsRef: found.ref,
    sizeBytes: found.measured.sizeBytes,
    storage: found.measured.storage,
  };
}

export interface RegisterPs2DiscInfo {
  /** URL original do disco (não a do proxy). */
  url?: string;
  /** Nome do arquivo como o Ps2LabPanel manda ao runner (romFilename). */
  fileName?: string;
  gameId?: string;
  title: string;
  coverUrl?: string;
  serial?: string;
}

/**
 * Registra um disco PS2 na "Minha Central" gravando SÓ metadados (o disco em si não é copiado).
 * O vínculo com o OPFS é calculado igual aos runners e conferido na hora de listar.
 * `alreadyOnDevice` diz se já havia algo gravado no OPFS para este disco (use para decidir
 * se mostra o aviso de "primeiro download" com notifyDownloadStarted).
 */
export async function registerPs2Disc(
  info: RegisterPs2DiscInfo,
): Promise<{ entry: LibraryEntry | null; alreadyOnDevice: boolean }> {
  const db = await openLibraryDb();
  if (!db) return { entry: null, alreadyOnDevice: false };
  // Guarda a URL como o Ps2LabPanel a envia ao runner (só trim): o hash do disco depende dela.
  const url = (info.url ?? '').trim();
  const filename = (info.fileName || (url ? ps2FileNameFromUrl(url) : '') || '').trim();
  const id = info.gameId || filename || info.title;
  if (!url && !id) return { entry: null, alreadyOnDevice: false };
  const key = normalizeKey(url) || `ps2:${id}`;
  try {
    const found = await locatePs2Disc({ url, filename, opfsRef: undefined });
    const tx = db.transaction(META_STORE, 'readwrite');
    const store = tx.objectStore(META_STORE);
    const prev = (await reqP(store.get(key))) as LibraryEntry | undefined;
    const now = Date.now();
    const entry: LibraryEntry = {
      key,
      url,
      filename: filename || prev?.filename || 'disco.iso',
      sizeBytes: found?.measured.sizeBytes ?? prev?.sizeBytes ?? 0,
      chunkCount: 0,
      savedAt: prev?.kind === 'ps2-disc' ? prev.savedAt : now,
      lastPlayedAt: now,
      complete: true,
      kind: 'ps2-disc',
      consoleId: 'ps2',
      ...(found ? { opfsRef: found.ref } : prev?.opfsRef ? { opfsRef: prev.opfsRef } : {}),
      ...cleanMeta({ gameId: info.gameId, title: info.title, coverUrl: info.coverUrl }),
      ...(info.serial ? { serial: info.serial } : {}),
    };
    store.put(entry);
    await txDone(tx);
    emitChange();
    return { entry, alreadyOnDevice: !!found };
  } catch {
    return { entry: null, alreadyOnDevice: false };
  }
}

/** true se este disco (URL/arquivo) já tem algo gravado no OPFS deste aparelho. */
export async function isPs2DiscOnDevice(info: { url?: string; fileName?: string }): Promise<boolean> {
  try {
    return !!(await locatePs2Disc({ url: (info.url ?? '').trim(), filename: info.fileName ?? '', opfsRef: undefined }));
  } catch {
    return false;
  }
}

async function removeOpfsEntry(dir: Ps2OpfsDir, name: string): Promise<boolean> {
  const root = await getOpfsRoot();
  if (!root) return false;
  let dirHandle: DirHandle;
  try {
    dirHandle = (await root.getDirectoryHandle(dir)) as DirHandle;
  } catch {
    return true; // pasta nem existe: nada a apagar
  }
  try {
    await dirHandle.removeEntry(name, { recursive: true });
    return true;
  } catch (err) {
    return (err as { name?: string } | null)?.name === 'NotFoundError';
  }
}

/** Apaga o disco ligado a esta entrada (só o arquivo/pasta dela; no turbo, também o .part). */
async function deletePs2DiscFiles(entry: LibraryEntry): Promise<boolean> {
  const found = await locatePs2Disc(entry);
  const ref = found?.ref ?? entry.opfsRef;
  if (!ref) return true; // nada gravado
  let ok = await removeOpfsEntry(ref.dir, ref.name);
  if (ok && ref.dir === 'vgfa-turbo-discs' && !ref.name.endsWith('.part')) {
    ok = await removeOpfsEntry(ref.dir, `${ref.name}.part`);
  }
  invalidateOpfsMeasure();
  return ok;
}

/** Lê o nome do volume (ISO-9660, offset 0x8028) — só leitura de 32 bytes. */
async function peekVolumeId(blob: Blob): Promise<string | undefined> {
  try {
    const raw = new Uint8Array(await blob.slice(0x8000, 0x8000 + 72).arrayBuffer());
    if (raw.length < 72 || raw[0] !== 1 || String.fromCharCode(...raw.slice(1, 6)) !== 'CD001') return undefined;
    const text = String.fromCharCode(...raw.slice(40, 72)).replace(/[^\x20-\x7e]/g, '').trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

async function peekDiscVolumeId(dirHandle: DirHandle, name: string, isDir: boolean): Promise<string | undefined> {
  try {
    if (!isDir) {
      if (name.endsWith('.part')) return undefined;
      return await peekVolumeId(await (await dirHandle.getFileHandle(name)).getFile());
    }
    const sub = await dirHandle.getDirectoryHandle(name);
    try {
      return await peekVolumeId(await (await sub.getFileHandle('full_disc.iso')).getFile());
    } catch {
      // sem ISO completa: tenta o primeiro pedaço (1 MiB cobre o offset 0x8000)
      return await peekVolumeId(await (await sub.getFileHandle('0.chk')).getFile());
    }
  } catch {
    return undefined;
  }
}

interface Recognized {
  gameId?: string;
  title?: string;
  url?: string;
  coverUrl?: string;
  consoleId?: string;
  fileName?: string;
  by: NonNullable<OpfsDiscInfo['recognizedBy']>;
}

/** Mapa `dir/name` → jogo conhecido (biblioteca, fontes do usuário e catálogo). */
async function buildRecognitionMap(): Promise<Map<string, Recognized>> {
  const map = new Map<string, Recognized>();
  const claim = async (
    src: { url?: string; fileName?: string },
    info: Omit<Recognized, 'by'>,
    by: Recognized['by'],
  ) => {
    for (const ref of await ps2OpfsCandidates(src)) {
      const k = `${ref.dir}/${ref.name}`;
      if (!map.has(k)) map.set(k, { ...info, by });
    }
  };

  // 1) metadados da própria biblioteca
  const db = await openLibraryDb();
  if (db) {
    try {
      const all = (await reqP(db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll())) as LibraryEntry[];
      for (const e of all) {
        if (!e || e.kind !== 'ps2-disc') continue;
        if (e.opfsRef) {
          const k = `${e.opfsRef.dir}/${e.opfsRef.name}`;
          if (!map.has(k)) {
            map.set(k, { gameId: e.gameId, title: e.title, url: e.url || undefined, coverUrl: e.coverUrl, consoleId: 'ps2', fileName: e.filename, by: 'library' });
          }
        }
        await claim(
          { url: e.url, fileName: e.filename },
          { gameId: e.gameId, title: e.title, url: e.url || undefined, coverUrl: e.coverUrl, consoleId: 'ps2', fileName: e.filename },
          'library',
        );
      }
    } catch {
      // ignora
    }
  }

  // 2) URLs que a própria pessoa vinculou a jogos
  try {
    for (const src of listUserSources()) {
      const game = ALL_STORE_GAMES.find((g) => g.id === src.gameId);
      await claim(
        { url: src.url, fileName: src.filename },
        { gameId: src.gameId, title: game?.title, url: src.url, coverUrl: game?.coverUrl, consoleId: game?.consoleId, fileName: src.filename },
        'user-source',
      );
    }
  } catch {
    // ignora
  }

  // 3) catálogo com link direto (só PS2)
  for (const g of ALL_STORE_GAMES) {
    if (g.consoleId !== 'ps2' || !g.freeRomUrl) continue;
    await claim(
      { url: g.freeRomUrl, fileName: g.freeRomFilename },
      { gameId: g.id, title: g.title, url: g.freeRomUrl, coverUrl: g.coverUrl, consoleId: g.consoleId, fileName: g.freeRomFilename },
      'catalog',
    );
  }
  return map;
}

function shortName(name: string): string {
  return name.length > 14 ? `${name.slice(0, 8)}…${name.slice(-4)}` : name;
}

/**
 * Tudo que há de disco PS2 no OPFS (as 3 pastas), com tamanho medido e, quando possível,
 * o nome do jogo. Só lê: nunca cria, move nem apaga nada.
 */
export async function listOpfsDiscs(): Promise<OpfsDiscInfo[]> {
  const root = await getOpfsRoot();
  if (!root) return [];
  let recognition: Map<string, Recognized> | null = null;
  const out: OpfsDiscInfo[] = [];
  for (const dir of OPFS_DIRS) {
    let dirHandle: DirHandle;
    try {
      dirHandle = (await root.getDirectoryHandle(dir)) as DirHandle;
    } catch {
      continue; // pasta não existe: nada a listar
    }
    try {
      for await (const [name, child] of dirHandle.entries()) {
        const isDir = child.kind !== 'file';
        const measured = await measureOpfsRef({ dir, name });
        const sizeBytes = measured.sizeBytes;
        let storage: Ps2DiscStorage = measured.storage;
        if (dir === 'vgfa-turbo-discs' && name.endsWith('.part')) storage = 'partial';

        const info: OpfsDiscInfo = { id: `${dir}/${name}`, dir, name, sizeBytes, storage, label: '' };

        if (dir === 'vgfa-turbo-discs') {
          // runner grava <nomeLimpo>.iso (+ .part): tira o '.iso'/.part de sufixo
          const base = name.replace(/\.part$/, '').replace(/\.iso$/, '');
          info.fileName = base || name;
        }

        if (dir !== 'vgfa-disc-cache') {
          recognition ??= await buildRecognitionMap();
          const known = recognition.get(`${dir}/${name.replace(/\.part$/, '')}`) ?? recognition.get(`${dir}/${name}`);
          if (known) {
            Object.assign(info, {
              gameId: known.gameId,
              title: known.title,
              url: known.url,
              coverUrl: known.coverUrl,
              consoleId: known.consoleId,
              recognizedBy: known.by,
            });
          }
          if (!info.title && !info.fileName) {
            const vol = await peekDiscVolumeId(dirHandle, name, isDir);
            if (vol) {
              info.volumeId = vol;
              info.recognizedBy = 'volume-id';
            }
          } else if (!info.title && info.fileName) {
            info.recognizedBy = info.recognizedBy ?? 'file-name';
          }
        }

        const sizeText = sizeBytes > 0 ? ` · ${formatBytes(sizeBytes)}` : '';
        if (dir === 'vgfa-disc-cache') {
          info.label = `Cache de disco PS2 · ${shortName(name)}`;
        } else if (info.title) {
          info.label = `${info.title}${sizeText}`;
        } else if (info.fileName) {
          info.label = `Disco PS2 · ${info.fileName}${sizeText}`;
        } else if (info.volumeId) {
          info.label = `Disco PS2 · ${info.volumeId}${sizeText}`;
        } else {
          info.label = `Disco PS2 instalado · ${shortName(name)}${sizeText}`;
        }
        out.push(info);
      }
    } catch {
      // ignora esta pasta
    }
  }
  return out;
}

/** Apaga exatamente esta pasta/arquivo do OPFS. Só chamar depois de a pessoa confirmar. */
export async function deleteOpfsDisc(dir: Ps2OpfsDir, name: string): Promise<boolean> {
  const ok = await removeOpfsEntry(dir, name);
  invalidateOpfsMeasure();
  emitChange();
  return ok;
}
