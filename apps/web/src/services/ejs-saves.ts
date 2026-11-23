/**
 * Saves automáticos dos jogos do EmulatorJS (Atari 2600 → PSP) + tempo de jogo.
 *
 * Como o EmulatorJS "stable" (4.2.3) funciona por dentro — conferido no código-fonte:
 *  - O iframe srcdoc é de MESMA origem; `iframe.contentWindow.EJS_emulator` é a instância
 *    (loader.js: `window.EJS_emulator = new EmulatorJS(...)`), com `.started`, `.paused`,
 *    `.gameManager` (EJS_GameManager) e `.on(evento, fn)`.
 *  - `gameManager.getState()` → Uint8Array (cópia) do save state; lança se o core não suporta.
 *    `gameManager.loadState(Uint8Array)` escreve /game.state e chama load_state.
 *    `gameManager.supportsStates()` → boolean. `gameManager.getFrameNum()` → nº do frame.
 *  - SRAM ("save interno" do jogo): o EmulatorJS monta /data/saves com IDBFS (autoPersist) →
 *    IndexedDB do próprio site (banco "/data/saves"), arquivo "<EJS_gameName sem #<$+%>!`&*'|{}/\?"=@:^>.srm".
 *    O RetroArch grava a SRAM no FS a cada 60 s (autosave_interval = 60) e no evento "exit".
 *    `gameManager.saveSaveFiles()` força essa gravação agora (é o que chamamos aqui).
 *
 * Por que um banco próprio (`vgfa_autosaves_v1`) e não o VgfaSaveStore:
 *  - O banco `vgfa_saves_v1` já existe (versão 1) e é do VgfaSaveStore; abrir com outra versão/stores
 *    quebraria os dois lados.
 *  - O VgfaSaveStore guarda 1 registro por slot com `data` junto do resumo (listar puxaria dezenas
 *    de MB) e não tem tempo de jogo. Aqui o resumo (`meta`) e os bytes (`blobs`) ficam em stores
 *    separados, e o anel "últimos 3 por jogo" é simples.
 *
 * O srcdoc (retro-engine.ts) manda `postMessage({ type: 'vgfa-ejs-started' })` ao iniciar (EJS_onGameStart);
 * o attach usa isso (conferindo `ev.source === iframe.contentWindow`) para armar o gancho de saída cedo.
 *
 * Nunca trava o jogo: tudo em try/catch, a cópia do estado é a única parte síncrona
 * (um `Uint8Array` copiado do heap do WASM) e a gravação no IndexedDB é assíncrona.
 */

// ==================== Tipos públicos ====================

export interface EjsAutosaveInfo {
  /** Identifica o jogo (recomendado: `session.id`, o mesmo `gameId` da biblioteca). */
  gameKey: string;
  title: string;
  consoleId: string;
  coverUrl?: string;
}

export interface EjsSaveMeta {
  id: string;
  gameKey: string;
  title: string;
  consoleId: string;
  coverUrl?: string;
  savedAt: number;
  sizeBytes: number;
  /** Tempo de jogo acumulado deste jogo neste aparelho quando o save foi feito. */
  playMs: number;
  /** interval | hidden | pagehide | exit | dispose | manual | ... */
  reason: string;
}

export interface EjsSave extends EjsSaveMeta {
  data: Uint8Array;
}

export interface PlayStat {
  ms: number;
  lastPlayedAt: number;
  sessions: number;
  title?: string;
  consoleId?: string;
  coverUrl?: string;
}

export interface PlayStats {
  totalMs: number;
  perGame: Record<string, PlayStat>;
}

export interface EjsAutosaveHandle {
  /** Para tudo, grava um último save e solta os ouvintes. Seguro chamar mais de uma vez. */
  dispose(): Promise<void>;
  /** Salva agora. Devolve false se não deu (jogo ainda carregando, core sem save state, nada mudou...). */
  saveNow(reason?: string): Promise<boolean>;
}

// ==================== Constantes ====================

const DB_NAME = 'vgfa_autosaves_v1';
const META_STORE = 'meta';
const BLOB_STORE = 'blobs';
const PLAY_STORE = 'playtime';
const KEEP_PER_GAME = 3;
const BASE_INTERVAL_MS = 60_000;
/** Estados grandes (PSP/N64) pesam: espaça os autosaves para não engasgar o aparelho. */
const MID_STATE_BYTES = 32 * 1024 * 1024;
const BIG_STATE_BYTES = 96 * 1024 * 1024;
const MAX_STATE_BYTES = 384 * 1024 * 1024;
/** Não grava autosave "de saída" de quem abriu e saiu em seguida (não empurra saves bons para fora do anel). */
const MIN_PLAY_FOR_AUTOSAVE_MS = 10_000;
const PLAY_FLUSH_MS = 30_000;

// ==================== IndexedDB ====================

let dbPromise: Promise<IDBDatabase | null> | null = null;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  const p = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META_STORE)) {
          const meta = db.createObjectStore(META_STORE, { keyPath: 'id' });
          meta.createIndex('byGame', 'gameKey', { unique: false });
        }
        if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
        if (!db.objectStoreNames.contains(PLAY_STORE)) db.createObjectStore(PLAY_STORE, { keyPath: 'gameKey' });
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

const bus: EventTarget | null = typeof EventTarget !== 'undefined' ? new EventTarget() : null;
let channel: BroadcastChannel | null = null;
let channelTried = false;

function getChannel(): BroadcastChannel | null {
  if (channelTried) return channel;
  channelTried = true;
  if (!hasIndexedDb() || typeof BroadcastChannel === 'undefined') return null;
  try {
    channel = new BroadcastChannel('vgfa-saves');
    channel.onmessage = () => {
      try {
        bus?.dispatchEvent(new Event('change'));
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
    bus?.dispatchEvent(new Event('change'));
  } catch {
    // ignora
  }
  try {
    getChannel()?.postMessage('change');
  } catch {
    // ignora
  }
}

/** Chama `cb` quando saves ou tempo de jogo mudam (nesta aba ou em outras). Devolve o cancelar. */
export function onSavesChange(cb: () => void): () => void {
  if (!bus) return () => undefined;
  getChannel();
  const handler = () => cb();
  bus.addEventListener('change', handler);
  return () => bus.removeEventListener('change', handler);
}

// ==================== Saves: gravar / ler / apagar ====================

interface Snapshot {
  gameKey: string;
  title: string;
  consoleId: string;
  coverUrl?: string;
  state: Uint8Array;
  playMs: number;
  reason: string;
}

function isQuotaError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

async function listMetaForGame(db: IDBDatabase, gameKey: string): Promise<EjsSaveMeta[]> {
  const tx = db.transaction(META_STORE, 'readonly');
  const rows = (await reqP(tx.objectStore(META_STORE).index('byGame').getAll(gameKey))) as EjsSaveMeta[];
  return rows.sort((a, b) => b.savedAt - a.savedAt);
}

async function removeIds(db: IDBDatabase, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite');
  for (const id of ids) {
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(BLOB_STORE).delete(id);
  }
  await txDone(tx);
}

async function writeSnapshot(db: IDBDatabase, snap: Snapshot): Promise<EjsSaveMeta> {
  const savedAt = Date.now();
  const meta: EjsSaveMeta = {
    id: `${snap.gameKey}#${savedAt}`,
    gameKey: snap.gameKey,
    title: snap.title,
    consoleId: snap.consoleId,
    ...(snap.coverUrl ? { coverUrl: snap.coverUrl } : {}),
    savedAt,
    sizeBytes: snap.state.byteLength,
    playMs: snap.playMs,
    reason: snap.reason,
  };
  const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite');
  tx.objectStore(META_STORE).put(meta);
  tx.objectStore(BLOB_STORE).put(snap.state, meta.id);
  await txDone(tx);
  return meta;
}

/** Grava e mantém só os últimos 3 por jogo. Sem espaço: abre lugar apagando o mais antigo e tenta de novo. */
async function persistSnapshot(snap: Snapshot): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  let meta: EjsSaveMeta;
  try {
    meta = await writeSnapshot(db, snap);
  } catch (err) {
    if (!isQuotaError(err)) return false;
    try {
      const old = await listMetaForGame(db, snap.gameKey);
      await removeIds(
        db,
        old.slice(-2).map((m) => m.id),
      );
      meta = await writeSnapshot(db, snap);
    } catch {
      return false;
    }
  }
  try {
    const all = await listMetaForGame(db, snap.gameKey);
    await removeIds(
      db,
      all.filter((m) => m.id !== meta.id).slice(KEEP_PER_GAME - 1).map((m) => m.id),
    );
  } catch {
    // limpeza do anel é melhor-esforço
  }
  emitChange();
  return true;
}

/** Resumo de todos os saves automáticos (mais recentes primeiro), sem carregar os bytes. */
export async function listSaves(): Promise<EjsSaveMeta[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction(META_STORE, 'readonly');
    const rows = (await reqP(tx.objectStore(META_STORE).getAll())) as EjsSaveMeta[];
    return rows.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** O autosave mais recente deste jogo (com os bytes), ou null. */
export async function getLatestSave(gameKey: string): Promise<EjsSave | null> {
  const db = await openDb();
  if (!db || !gameKey) return null;
  try {
    for (const meta of await listMetaForGame(db, gameKey)) {
      const data = (await reqP(db.transaction(BLOB_STORE, 'readonly').objectStore(BLOB_STORE).get(meta.id))) as
        | Uint8Array
        | ArrayBuffer
        | undefined;
      if (!data) continue;
      return { ...meta, data: data instanceof Uint8Array ? data : new Uint8Array(data) };
    }
  } catch {
    // sem save legível
  }
  return null;
}

/** Apaga todos os autosaves deste jogo (o tempo de jogo fica). */
export async function deleteSaves(gameKey: string): Promise<void> {
  const db = await openDb();
  if (!db || !gameKey) return;
  try {
    const ids = (await listMetaForGame(db, gameKey)).map((m) => m.id);
    await removeIds(db, ids);
    emitChange();
  } catch {
    // ignora
  }
}

// ==================== Tempo de jogo ====================

async function addPlayTime(
  gameKey: string,
  ms: number,
  meta: { title?: string; consoleId?: string; coverUrl?: string } | undefined,
  newSession: boolean,
): Promise<void> {
  const db = await openDb();
  if (!db || !gameKey) return;
  if (!(ms > 0) && !newSession) return;
  try {
    const tx = db.transaction(PLAY_STORE, 'readwrite');
    const store = tx.objectStore(PLAY_STORE);
    const prev = (await reqP(store.get(gameKey))) as (PlayStat & { gameKey: string }) | undefined;
    const next: PlayStat & { gameKey: string } = {
      gameKey,
      ms: (prev?.ms ?? 0) + Math.max(0, Math.round(ms)),
      lastPlayedAt: Date.now(),
      sessions: (prev?.sessions ?? 0) + (newSession ? 1 : 0),
      title: meta?.title || prev?.title,
      consoleId: meta?.consoleId || prev?.consoleId,
      coverUrl: meta?.coverUrl || prev?.coverUrl,
    };
    store.put(next);
    await txDone(tx);
    emitChange();
  } catch {
    // estatística não é crítica
  }
}

/**
 * Soma `ms` ao tempo de jogo de `gameKey` e conta uma sessão.
 * Para motores sem autosave (embutidos, PS2). O `attachEjsAutosave` já faz isso sozinho.
 */
export function recordPlayTime(
  gameKey: string,
  ms: number,
  meta?: { title?: string; consoleId?: string; coverUrl?: string },
): Promise<void> {
  return addPlayTime(gameKey, ms, meta, true);
}

export async function getPlayStats(): Promise<PlayStats> {
  const out: PlayStats = { totalMs: 0, perGame: {} };
  const db = await openDb();
  if (!db) return out;
  try {
    const rows = (await reqP(db.transaction(PLAY_STORE, 'readonly').objectStore(PLAY_STORE).getAll())) as Array<
      PlayStat & { gameKey: string }
    >;
    for (const { gameKey, ...stat } of rows) {
      out.perGame[gameKey] = stat;
      out.totalMs += stat.ms;
    }
  } catch {
    // vazio
  }
  return out;
}

// ==================== Ponte com o EmulatorJS ====================

interface EjsGameManager {
  getState(): Uint8Array;
  loadState(state: Uint8Array): void;
  supportsStates(): boolean;
  saveSaveFiles(): void;
  getFrameNum?(): number;
}

interface EjsEmulator {
  started?: boolean;
  paused?: boolean;
  failedToStart?: boolean;
  gameManager?: EjsGameManager;
  functions?: Record<string, Array<(data?: unknown) => void> | undefined>;
  on?(event: string, fn: (data?: unknown) => void): void;
}

function readEmulator(iframe: HTMLIFrameElement): EjsEmulator | null {
  try {
    const win = iframe.contentWindow as (Window & { EJS_emulator?: EjsEmulator }) | null;
    return win?.EJS_emulator ?? null;
  } catch {
    return null; // iframe de outra origem ou já descartado
  }
}

function isReady(emu: EjsEmulator | null): emu is EjsEmulator & { gameManager: EjsGameManager } {
  return !!emu && emu.started === true && !emu.failedToStart && typeof emu.gameManager?.getState === 'function';
}

function frameOf(gm: EjsGameManager): number | null {
  try {
    const n = gm.getFrameNum?.();
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Liga o autosave a um iframe do EmulatorJS: salva a cada 60 s de jogo (mais espaçado se o estado for
 * grande), ao esconder a aba, no pagehide, ao sair do EmulatorJS (evento "exit", antes do reset dele)
 * e no dispose. Também força a gravação da SRAM e soma o tempo de jogo sozinho.
 */
export function attachEjsAutosave(iframe: HTMLIFrameElement, info: EjsAutosaveInfo): EjsAutosaveHandle {
  const meta = { title: info.title, consoleId: info.consoleId, coverUrl: info.coverUrl };
  let disposed = false;
  let disposing = false;
  let exited = false;
  let lastEmu: EjsEmulator | null = null;
  let hookedEmu: EjsEmulator | null = null;
  let playMs = 0; // tempo jogado desde que ligou
  let sinceSaveMs = 0;
  let unflushedMs = 0;
  let sessionCounted = false;
  let intervalMs = BASE_INTERVAL_MS;
  let lastSavedFrame: number | null = null;
  let lastSavedAt = 0;
  let lastTick = Date.now();
  let queue: Promise<unknown> = Promise.resolve();

  const getEmu = (): EjsEmulator | null => {
    const fresh = readEmulator(iframe);
    if (fresh) {
      if (fresh !== lastEmu) {
        // recarregou o jogo no mesmo iframe: recomeça a contagem da sessão
        lastEmu = fresh;
        hookedEmu = null;
        exited = false;
        lastSavedFrame = null;
      }
      return fresh;
    }
    return lastEmu; // iframe já saiu da tela: tenta com a instância que conhecemos
  };

  const flushPlayTime = (): Promise<void> => {
    const ms = unflushedMs;
    unflushedMs = 0;
    if (ms <= 0 && sessionCounted) return Promise.resolve();
    const first = !sessionCounted;
    if (ms > 0) sessionCounted = true;
    return addPlayTime(info.gameKey, ms, meta, first && ms > 0);
  };

  /** Parte SÍNCRONA: força a SRAM e copia o estado agora (antes de qualquer reset). */
  const capture = (reason: string): Snapshot | null => {
    try {
      const emu = getEmu();
      if (!isReady(emu) || exited) return null;
      const gm = emu.gameManager;
      try {
        gm.saveSaveFiles(); // SRAM → /data/saves (o IDBFS do EmulatorJS grava no IndexedDB)
      } catch {
        // core sem arquivo de save
      }
      if (!gm.supportsStates()) return null;
      if (reason !== 'manual' && playMs < MIN_PLAY_FOR_AUTOSAVE_MS) return null;
      const frame = frameOf(gm);
      if (reason !== 'manual' && frame !== null && frame === lastSavedFrame) return null; // nada mudou
      // saída logo depois de outro save (ex.: Voltar → fechar): não duplica o mesmo momento
      if ((reason === 'dispose' || reason === 'pagehide' || reason === 'hidden' || reason === 'exit') && Date.now() - lastSavedAt < 5000) return null;
      const state = gm.getState();
      if (!state || state.byteLength === 0 || state.byteLength > MAX_STATE_BYTES) return null;
      lastSavedFrame = frame;
      lastSavedAt = Date.now();
      sinceSaveMs = 0;
      return { ...meta, gameKey: info.gameKey, state, playMs, reason };
    } catch {
      return null;
    }
  };

  const enqueue = (snap: Snapshot): Promise<boolean> => {
    const job = queue.then(async () => {
      const ok = await persistSnapshot(snap);
      if (!ok) lastSavedFrame = null;
      const size = snap.state.byteLength;
      intervalMs = size > BIG_STATE_BYTES ? 0 : size > MID_STATE_BYTES ? 3 * BASE_INTERVAL_MS : BASE_INTERVAL_MS;
      return ok;
    });
    queue = job.catch(() => false);
    return job.catch(() => false);
  };

  const saveNow = async (reason = 'manual'): Promise<boolean> => {
    if (disposed || (disposing && reason !== 'dispose')) return false;
    try {
      const snap = capture(reason);
      void flushPlayTime();
      return snap ? await enqueue(snap) : false;
    } catch {
      return false;
    }
  };

  /** Antes de o EmulatorJS dar `restart()` ao sair, copia o estado mais recente. */
  const hookExit = (emu: EjsEmulator) => {
    if (hookedEmu === emu) return;
    hookedEmu = emu;
    const onExit = () => {
      try {
        const snap = capture('exit');
        if (snap) void enqueue(snap);
        void flushPlayTime();
      } catch {
        // ignora
      }
      exited = true;
    };
    try {
      const fns = (emu.functions ??= {});
      const list = (fns.exit ??= []);
      list.unshift(onExit); // roda ANTES do handler do GameManager (que reinicia o jogo)
    } catch {
      try {
        emu.on?.('exit', onExit);
      } catch {
        // sem como ouvir: ainda temos hidden/pagehide/intervalo
      }
    }
  };

  const tick = () => {
    const now = Date.now();
    const dt = Math.min(Math.max(0, now - lastTick), 3000);
    lastTick = now;
    if (disposed || disposing) return;
    try {
      const emu = getEmu();
      if (!isReady(emu)) return;
      hookExit(emu);
      if (emu.paused || pageHidden() || exited) return;
      playMs += dt;
      unflushedMs += dt;
      sinceSaveMs += dt;
      if (intervalMs > 0 && sinceSaveMs >= intervalMs) {
        sinceSaveMs = 0;
        void saveNow('interval');
      } else if (unflushedMs >= PLAY_FLUSH_MS) {
        void flushPlayTime();
      }
    } catch {
      // nunca derruba o jogo
    }
  };

  const onVisibility = () => {
    if (pageHidden()) void saveNow('hidden');
    else lastTick = Date.now();
  };
  const onPageHide = () => {
    void saveNow('pagehide');
  };

  /** O srcdoc avisa (EJS_onGameStart → postMessage) assim que o jogo começa: liga o gancho de saída já. */
  const onMessage = (ev: MessageEvent) => {
    try {
      if (ev.source !== iframe.contentWindow) return;
      if ((ev.data as { type?: string } | null)?.type !== 'vgfa-ejs-started') return;
      lastTick = Date.now();
      const emu = getEmu();
      if (isReady(emu)) hookExit(emu);
    } catch {
      // ignora
    }
  };

  const timer = setInterval(tick, 1000);
  try {
    window.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
  } catch {
    // sem DOM
  }

  const dispose = async (): Promise<void> => {
    if (disposed || disposing) return;
    disposing = true;
    try {
      await saveNow('dispose');
    } catch {
      // ignora
    }
    disposed = true;
    clearInterval(timer);
    try {
      window.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    } catch {
      // ignora
    }
    await flushPlayTime().catch(() => undefined);
  };

  return { dispose, saveNow };
}

/**
 * Restaura um autosave no jogo que está rodando no iframe. Espera o jogo terminar de carregar
 * (até 2 min) e dar alguns frames; devolve false se o iframe sumiu, o jogo falhou ou deu erro.
 */
export async function loadSaveInto(iframe: HTMLIFrameElement, save: EjsSave): Promise<boolean> {
  const deadline = Date.now() + 120_000;
  let readyAt = 0;
  try {
    while (Date.now() < deadline) {
      const emu = readEmulator(iframe);
      if (emu?.failedToStart) return false;
      if (isReady(emu)) {
        if (!readyAt) readyAt = Date.now();
        const frame = frameOf(emu.gameManager);
        if (Date.now() - readyAt >= 700 && (frame === null || frame >= 20)) {
          emu.gameManager.loadState(save.data);
          return true;
        }
      }
      if (!iframe.isConnected) return false;
      await sleep(250);
    }
  } catch {
    // estado incompatível ou jogo mudou
  }
  return false;
}
