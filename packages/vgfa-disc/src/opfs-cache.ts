import type { ChunkCacheStore } from './types.js';

interface LruEntry {
  data: Uint8Array;
  lastAccess: number;
}

/**
 * Cache L1 em memória (LRU com orçamento rígido de bytes).
 * Mantém a pegada de RAM baixa mesmo para ISOs de DVD9 (8.5 GB).
 */
export class MemoryChunkCache implements ChunkCacheStore {
  readonly kind = 'memory' as const;
  private readonly entries = new Map<string, LruEntry>();
  private currentBytes = 0;
  private clock = 0;

  constructor(private readonly maxBytes: number = 32 * 1024 * 1024) {}

  private key(discId: string, chunkIndex: number): string {
    return `${discId}:${chunkIndex}`;
  }

  getSync(discId: string, chunkIndex: number): Uint8Array | null {
    const k = this.key(discId, chunkIndex);
    const entry = this.entries.get(k);
    if (!entry) return null;
    entry.lastAccess = ++this.clock;
    this.entries.delete(k);
    this.entries.set(k, entry);
    return entry.data;
  }

  async get(discId: string, chunkIndex: number): Promise<Uint8Array | null> {
    return this.getSync(discId, chunkIndex);
  }

  async put(discId: string, chunkIndex: number, data: Uint8Array): Promise<void> {
    const k = this.key(discId, chunkIndex);
    const existing = this.entries.get(k);
    if (existing) {
      this.currentBytes -= existing.data.byteLength;
      this.entries.delete(k);
    }

    if (data.byteLength > this.maxBytes) {
      return;
    }

    while (this.currentBytes + data.byteLength > this.maxBytes && this.entries.size > 0) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      if (oldest) {
        this.currentBytes -= oldest.data.byteLength;
      }
      this.entries.delete(oldestKey);
    }

    this.entries.set(k, { data, lastAccess: ++this.clock });
    this.currentBytes += data.byteLength;
  }

  async has(discId: string, chunkIndex: number): Promise<boolean> {
    return this.entries.has(this.key(discId, chunkIndex));
  }

  async stats(discId?: string): Promise<{ chunks: number; bytes: number }> {
    if (!discId) {
      return { chunks: this.entries.size, bytes: this.currentBytes };
    }
    const prefix = `${discId}:`;
    let chunks = 0;
    let bytes = 0;
    for (const [k, v] of this.entries) {
      if (k.startsWith(prefix)) {
        chunks++;
        bytes += v.data.byteLength;
      }
    }
    return { chunks, bytes };
  }

  async clear(discId?: string): Promise<void> {
    if (!discId) {
      this.entries.clear();
      this.currentBytes = 0;
      return;
    }
    const prefix = `${discId}:`;
    for (const [k, v] of this.entries) {
      if (k.startsWith(prefix)) {
        this.currentBytes -= v.data.byteLength;
        this.entries.delete(k);
      }
    }
  }
}

/**
 * Cache L2 persistente em OPFS (Origin Private File System) usando arquivos sharded por chunk.
 *
 * Por que sharded em vez de 1 arquivo monolítico?
 * Pesquisa da Fase 0 (TabStationToo DISC-DESIGN.md) provou que builds Chromium impõem
 * limite rígido de 2.000 MiB por arquivo individual no OPFS. Dividindo em chunks esparsos
 * de 256 KiB em subdiretórios (vgfa-disc-cache/<discId>/<bucket>/<chunk>.chk), nunca
 * atingimos esse teto e ainda obtemos leitura quase de SSD entre sessões!
 */
export class ShardedOpfsChunkCache implements ChunkCacheStore {
  readonly kind = 'opfs' as const;
  private rootDirPromise: Promise<FileSystemDirectoryHandle | null> | null = null;
  private readonly knownChunks = new Map<string, number>(); // "discId:chunk" -> bytes
  private totalBytes = 0;

  constructor(private readonly maxBudgetBytes: number = 384 * 1024 * 1024) {}

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
  }

  private async getRoot(): Promise<FileSystemDirectoryHandle | null> {
    if (!ShardedOpfsChunkCache.isSupported()) return null;
    if (!this.rootDirPromise) {
      this.rootDirPromise = navigator.storage
        .getDirectory()
        .then((root) => root.getDirectoryHandle('vgfa-disc-cache', { create: true }))
        .catch(() => null);
    }
    return this.rootDirPromise;
  }

  private sanitize(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'disc';
  }

  private async getBucketDir(
    discId: string,
    chunkIndex: number,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | null> {
    const root = await this.getRoot();
    if (!root) return null;
    const safeDisc = this.sanitize(discId);
    const bucket = String(Math.floor(chunkIndex / 256));
    try {
      const discDir = await root.getDirectoryHandle(safeDisc, { create });
      return await discDir.getDirectoryHandle(bucket, { create });
    } catch {
      return null;
    }
  }

  async get(discId: string, chunkIndex: number): Promise<Uint8Array | null> {
    const bucketDir = await this.getBucketDir(discId, chunkIndex, false);
    if (!bucketDir) return null;
    try {
      const handle = await bucketDir.getFileHandle(`${chunkIndex}.chk`, { create: false });
      const file = await handle.getFile();
      const buf = new Uint8Array(await file.arrayBuffer());
      const k = `${discId}:${chunkIndex}`;
      if (!this.knownChunks.has(k)) {
        this.knownChunks.set(k, buf.byteLength);
        this.totalBytes += buf.byteLength;
      }
      return buf;
    } catch {
      return null;
    }
  }

  async put(discId: string, chunkIndex: number, data: Uint8Array): Promise<void> {
    if (this.totalBytes + data.byteLength > this.maxBudgetBytes) {
      await this.evictOldest(data.byteLength);
    }
    const bucketDir = await this.getBucketDir(discId, chunkIndex, true);
    if (!bucketDir) return;
    try {
      const handle = await bucketDir.getFileHandle(`${chunkIndex}.chk`, { create: true });
      const writable = await handle.createWritable();
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      await writable.write(copy);
      await writable.close();

      const k = `${discId}:${chunkIndex}`;
      const prev = this.knownChunks.get(k) ?? 0;
      this.knownChunks.set(k, data.byteLength);
      this.totalBytes += data.byteLength - prev;
    } catch {
      // Silencioso em caso de quota excedida (cache L2 é opcional)
    }
  }

  private async evictOldest(neededBytes: number): Promise<void> {
    let freed = 0;
    for (const [k, size] of this.knownChunks) {
      if (this.totalBytes - freed + neededBytes <= this.maxBudgetBytes) break;
      const [discId, chunkStr] = k.split(':');
      const chunkIndex = Number(chunkStr);
      const bucketDir = await this.getBucketDir(discId, chunkIndex, false);
      if (bucketDir) {
        await bucketDir.removeEntry(`${chunkIndex}.chk`).catch(() => {});
      }
      this.knownChunks.delete(k);
      freed += size;
    }
    this.totalBytes = Math.max(0, this.totalBytes - freed);
  }

  async has(discId: string, chunkIndex: number): Promise<boolean> {
    if (this.knownChunks.has(`${discId}:${chunkIndex}`)) return true;
    const bucketDir = await this.getBucketDir(discId, chunkIndex, false);
    if (!bucketDir) return false;
    try {
      await bucketDir.getFileHandle(`${chunkIndex}.chk`, { create: false });
      return true;
    } catch {
      return false;
    }
  }

  async stats(discId?: string): Promise<{ chunks: number; bytes: number }> {
    if (!discId) {
      return { chunks: this.knownChunks.size, bytes: this.totalBytes };
    }
    const prefix = `${discId}:`;
    let chunks = 0;
    let bytes = 0;
    for (const [k, size] of this.knownChunks) {
      if (k.startsWith(prefix)) {
        chunks++;
        bytes += size;
      }
    }
    return { chunks, bytes };
  }

  async clear(discId?: string): Promise<void> {
    const root = await this.getRoot();
    if (!root) return;
    if (discId) {
      const safeDisc = this.sanitize(discId);
      await root.removeEntry(safeDisc, { recursive: true }).catch(() => {});
      const prefix = `${discId}:`;
      for (const [k, size] of this.knownChunks) {
        if (k.startsWith(prefix)) {
          this.totalBytes = Math.max(0, this.totalBytes - size);
          this.knownChunks.delete(k);
        }
      }
      return;
    }
    for (const key of Array.from(this.knownChunks.keys())) {
      const disc = key.split(':')[0];
      await root.removeEntry(this.sanitize(disc), { recursive: true }).catch(() => {});
    }
    this.knownChunks.clear();
    this.totalBytes = 0;
  }
}
