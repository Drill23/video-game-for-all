import { MemoryChunkCache } from './opfs-cache.js';
import type { ChunkCacheStore, DiscMetrics, DiscSource, VirtualDiscOptions } from './types.js';

const DEFAULT_CHUNK_BYTES = 256 * 1024; // 256 KiB (excelente equilíbrio HTTP Range + OPFS + P2P)
const DEFAULT_MAX_RAM_BYTES = 32 * 1024 * 1024; // 32 MiB L1 RAM LRU
const DEFAULT_MAX_READ_AHEAD = 6;

/**
 * VGFA VirtualChunkedDisc — Motor próprio de Disco Virtual em Streaming.
 *
 * Supera as limitações dos projetos existentes combinando:
 * 1. L1 RAM LRU rígido (32 MiB por padrão) — nunca estoura memória com ISOs de 4.7–8.5 GB;
 * 2. L2 Sharded OPFS persistente — nunca bate no limite de 2.000 MiB por arquivo do Chrome;
 * 3. Deduplicação in-flight — 4 threads pedindo o mesmo setor fazem apenas 1 leitura real;
 * 4. Read-ahead sequencial adaptativo (`run * 2`, inspirado em ps2-web-recomp);
 * 5. Suporte transparente a Local File, HTTP Range e WebTorrent P2P WebRTC.
 */
export class VirtualChunkedDisc {
  readonly chunkSize: number;
  readonly maxReadAhead: number;
  private readonly l1: MemoryChunkCache;
  private readonly l2: ChunkCacheStore | null;
  private readonly inFlight = new Map<number, Promise<Uint8Array>>();
  private readonly prefetchedSet = new Set<number>();

  private totalReads = 0;
  private l1RamHits = 0;
  private l2OpfsHits = 0;
  private sourceMisses = 0;
  private prefetchHits = 0;
  private bytesFromSource = 0;
  private bytesFromCache = 0;
  private totalLatencyMs = 0;
  private lastChunkIndex = -1;
  private sequentialRun = 0;
  private recentChunks: number[] = [];
  private opfsCachedChunks = 0;
  private opfsCachedBytes = 0;
  private closed = false;

  constructor(
    public readonly source: DiscSource,
    private readonly options: VirtualDiscOptions = {},
  ) {
    this.chunkSize = options.chunkSizeBytes ?? DEFAULT_CHUNK_BYTES;
    this.maxReadAhead = options.maxReadAheadChunks ?? DEFAULT_MAX_READ_AHEAD;
    this.l1 = new MemoryChunkCache(options.maxRamCacheBytes ?? DEFAULT_MAX_RAM_BYTES);
    this.l2 = options.persistentCache ?? null;
  }

  get id(): string {
    return this.source.id;
  }

  get name(): string {
    return this.source.name;
  }

  get size(): number {
    return this.source.size;
  }

  get totalChunks(): number {
    return Math.ceil(this.source.size / this.chunkSize);
  }

  async read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    if (this.closed) {
      throw new Error('VirtualChunkedDisc foi fechado.');
    }
    if (offset < 0 || offset >= this.size || length <= 0) {
      return new Uint8Array(0);
    }

    const startTime = performance.now();
    const clampedLen = Math.min(length, this.size - offset);
    const out = new Uint8Array(clampedLen);

    const firstChunk = Math.floor(offset / this.chunkSize);
    const lastChunk = Math.floor((offset + clampedLen - 1) / this.chunkSize);

    // Atualiza detector de sequência para prefetch adaptativo
    this.updateSequentialRun(firstChunk);

    let outPos = 0;
    for (let idx = firstChunk; idx <= lastChunk; idx++) {
      const chunkData = await this.getChunk(idx, false, signal);
      const chunkStart = idx * this.chunkSize;
      const sliceStart = Math.max(0, offset - chunkStart);
      const sliceEnd = Math.min(chunkData.byteLength, offset + clampedLen - chunkStart);
      const sliceLen = Math.max(0, sliceEnd - sliceStart);
      if (sliceLen > 0) {
        out.set(chunkData.subarray(sliceStart, sliceEnd), outPos);
        outPos += sliceLen;
      }
      this.recordRecentChunk(idx);
    }

    // Dispara prefetch em background se detectou padrão sequencial
    this.scheduleReadAhead(lastChunk);

    this.totalReads++;
    this.totalLatencyMs += performance.now() - startTime;
    await this.emitMetrics();

    return outPos === clampedLen ? out : out.subarray(0, outPos);
  }

  private updateSequentialRun(chunkIndex: number): void {
    if (this.lastChunkIndex === -1) {
      this.sequentialRun = 1;
    } else if (chunkIndex === this.lastChunkIndex + 1) {
      this.sequentialRun = Math.min(this.sequentialRun + 1, 16);
    } else if (chunkIndex !== this.lastChunkIndex) {
      this.sequentialRun = 0;
    }
    this.lastChunkIndex = chunkIndex;
  }

  private scheduleReadAhead(lastChunk: number): void {
    if (this.maxReadAhead <= 0 || this.sequentialRun < 1) return;
    const count = Math.min(this.sequentialRun * 2, this.maxReadAhead);
    for (let k = 1; k <= count; k++) {
      const nextIdx = lastChunk + k;
      if (nextIdx >= this.totalChunks) break;
      if (this.inFlight.has(nextIdx)) continue;
      // Prefetch silencioso em segundo plano
      void this.getChunk(nextIdx, true).catch(() => {});
    }
  }

  private getChunk(
    chunkIndex: number,
    isPrefetch: boolean,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    // 1. L1 RAM Cache (síncrono — evita qualquer corrida de microtask entre threads concorrentes)
    const fromL1 = this.l1.getSync(this.id, chunkIndex);
    if (fromL1) {
      if (!isPrefetch) {
        this.l1RamHits++;
        this.bytesFromCache += fromL1.byteLength;
        if (this.prefetchedSet.delete(chunkIndex)) {
          this.prefetchHits++;
        }
      }
      return Promise.resolve(fromL1);
    }

    // 2. Deduplicação in-flight síncrona (coalescing garantido de leituras concorrentes)
    const pending = this.inFlight.get(chunkIndex);
    if (pending) {
      return pending;
    }

    const loadPromise = this.loadChunkFromL2OrSource(chunkIndex, isPrefetch, signal).finally(() => {
      this.inFlight.delete(chunkIndex);
    });
    this.inFlight.set(chunkIndex, loadPromise);
    return loadPromise;
  }

  private async loadChunkFromL2OrSource(
    chunkIndex: number,
    isPrefetch: boolean,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    // 2a. L2 Persistent OPFS Cache
    if (this.l2) {
      const fromL2 = await this.l2.get(this.id, chunkIndex);
      if (fromL2) {
        if (!isPrefetch) {
          this.l2OpfsHits++;
          this.bytesFromCache += fromL2.byteLength;
        }
        await this.l1.put(this.id, chunkIndex, fromL2);
        return fromL2;
      }
    }

    // 3. Fonte real (Local File / HTTP Range / WebTorrent P2P)
    const offset = chunkIndex * this.chunkSize;
    const reqLen = Math.min(this.chunkSize, this.size - offset);
    const raw = await this.source.readRaw(offset, reqLen, signal);

    if (!isPrefetch) {
      this.sourceMisses++;
    } else {
      this.prefetchedSet.add(chunkIndex);
    }
    this.bytesFromSource += raw.byteLength;

    await this.l1.put(this.id, chunkIndex, raw);
    if (this.l2) {
      void this.l2
        .put(this.id, chunkIndex, raw)
        .then(() => this.refreshL2Stats())
        .catch(() => {});
    }

    return raw;
  }

  private async refreshL2Stats(): Promise<void> {
    if (!this.l2) return;
    const s = await this.l2.stats(this.id);
    this.opfsCachedChunks = s.chunks;
    this.opfsCachedBytes = s.bytes;
  }

  private recordRecentChunk(chunkIndex: number): void {
    this.recentChunks.push(chunkIndex);
    if (this.recentChunks.length > 48) {
      this.recentChunks.shift();
    }
  }

  async getMetrics(): Promise<DiscMetrics> {
    const l1Stats = await this.l1.stats(this.id);
    if (this.l2 && this.opfsCachedChunks === 0) {
      await this.refreshL2Stats();
    }
    return {
      discId: this.id,
      sourceKind: this.source.kind,
      discSizeBytes: this.size,
      chunkSizeBytes: this.chunkSize,
      totalReads: this.totalReads,
      l1RamHits: this.l1RamHits,
      l2OpfsHits: this.l2OpfsHits,
      sourceMisses: this.sourceMisses,
      prefetchHits: this.prefetchHits,
      bytesFromSource: this.bytesFromSource,
      bytesFromCache: this.bytesFromCache,
      ramCachedChunks: l1Stats.chunks,
      ramCachedBytes: l1Stats.bytes,
      opfsCachedChunks: this.opfsCachedChunks,
      opfsCachedBytes: this.opfsCachedBytes,
      avgReadLatencyMs: this.totalReads > 0 ? this.totalLatencyMs / this.totalReads : 0,
      lastChunkIndex: this.lastChunkIndex,
      sequentialRun: this.sequentialRun,
      peerCount: this.source.getPeerCount?.() ?? 0,
      recentChunks: [...this.recentChunks],
    };
  }

  private async emitMetrics(): Promise<void> {
    if (!this.options.onMetrics) return;
    this.options.onMetrics(await this.getMetrics());
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.source.close?.();
  }
}
