export type SaveKind = 'state' | 'sram' | 'memcard-ps1' | 'memcard-ps2' | 'score';

export interface SaveSlotRecord {
  id: string; // `${userId}:${consoleId}:${gameId}:${kind}:${slot}`
  userId: string;
  consoleId: string;
  gameId: string;
  gameTitle: string;
  kind: SaveKind;
  slot: number;
  updatedAt: number;
  sizeBytes: number;
  data: Uint8Array;
  thumbnailDataUrl?: string;
}

export interface SaveSlotSummary {
  id: string;
  userId: string;
  consoleId: string;
  gameId: string;
  gameTitle: string;
  kind: SaveKind;
  slot: number;
  updatedAt: number;
  sizeBytes: number;
  thumbnailDataUrl?: string;
}

const DB_NAME = 'vgfa_saves_v1';
const STORE_NAME = 'saves';
const DB_VERSION = 1;

function buildKey(userId: string, consoleId: string, gameId: string, kind: SaveKind, slot: number): string {
  return `${userId}:${consoleId}:${gameId}:${kind}:${slot}`;
}

/**
 * Armazenamento persistente de saves no navegador (IndexedDB + fallback em memória/localStorage).
 *
 * Por que IndexedDB além de localStorage?
 * - localStorage trava em ~5 MB e só aceita strings.
 * - Um Memory Card de PS2 (.ps2) tem 8 MB binários e save states de N64/PS1/PS2 têm 2–32 MB.
 * - IndexedDB armazena Uint8Array binário nativo com centenas de MB e sobrevive a recargas.
 */
export class VgfaSaveStore {
  private memoryFallback = new Map<string, SaveSlotRecord>();
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  private getDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') {
      return Promise.resolve(null);
    }
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
              const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
              store.createIndex('byUser', 'userId', { unique: false });
              store.createIndex('byGame', ['userId', 'gameId'], { unique: false });
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return this.dbPromise;
  }

  async put(input: Omit<SaveSlotRecord, 'id' | 'updatedAt' | 'sizeBytes'>): Promise<SaveSlotSummary> {
    const id = buildKey(input.userId, input.consoleId, input.gameId, input.kind, input.slot);
    const record: SaveSlotRecord = {
      ...input,
      id,
      updatedAt: Date.now(),
      sizeBytes: input.data.byteLength,
    };

    const db = await this.getDb();
    if (!db) {
      this.memoryFallback.set(id, record);
    } else {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    const { data: _omitted, ...summary } = record;
    return summary;
  }

  async get(
    userId: string,
    consoleId: string,
    gameId: string,
    kind: SaveKind,
    slot: number,
  ): Promise<SaveSlotRecord | null> {
    const id = buildKey(userId, consoleId, gameId, kind, slot);
    const db = await this.getDb();
    if (!db) {
      return this.memoryFallback.get(id) ?? null;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve((req.result as SaveSlotRecord | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async listByUser(userId: string, gameId?: string): Promise<SaveSlotSummary[]> {
    const db = await this.getDb();
    let rows: SaveSlotRecord[] = [];
    if (!db) {
      rows = Array.from(this.memoryFallback.values()).filter(
        (r) => r.userId === userId && (!gameId || r.gameId === gameId),
      );
    } else {
      rows = await new Promise<SaveSlotRecord[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = gameId
          ? store.index('byGame').getAll([userId, gameId])
          : store.index('byUser').getAll(userId);
        req.onsuccess = () => resolve((req.result as SaveSlotRecord[]) ?? []);
        req.onerror = () => reject(req.error);
      });
    }

    return rows
      .map(({ data: _omit, ...summary }) => summary)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async remove(id: string): Promise<void> {
    const db = await this.getDb();
    if (!db) {
      this.memoryFallback.delete(id);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getById(id: string): Promise<SaveSlotRecord | null> {
    const db = await this.getDb();
    if (!db) {
      return this.memoryFallback.get(id) ?? null;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve((req.result as SaveSlotRecord | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Cria um Memory Card formatado em branco (128 KiB para PS1, 8 MiB para PS2).
   */
  static createBlankMemoryCard(kind: 'memcard-ps1' | 'memcard-ps2'): Uint8Array {
    const bytes = kind === 'memcard-ps1' ? 128 * 1024 : 8 * 1024 * 1024;
    const buf = new Uint8Array(bytes);
    if (kind === 'memcard-ps1') {
      buf[0] = 0x4d; // 'M'
      buf[1] = 0x43; // 'C'
    } else {
      // Cabeçalho padrão Sony PS2 Memory Card
      const header = new TextEncoder().encode('Sony PS2 Memory Card Format 1.2.0.0');
      buf.set(header, 0);
    }
    return buf;
  }
}
