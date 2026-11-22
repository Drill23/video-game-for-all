export type DiscSourceKind = 'local-file' | 'http-range' | 'webtorrent' | 'memory';

export interface DiscSource {
  readonly id: string;
  readonly name: string;
  readonly kind: DiscSourceKind;
  readonly size: number;
  readRaw(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>;
  getPeerCount?(): number;
  close?(): Promise<void> | void;
}

export interface ChunkCacheStore {
  readonly kind: 'memory' | 'opfs';
  get(discId: string, chunkIndex: number): Promise<Uint8Array | null>;
  put(discId: string, chunkIndex: number, data: Uint8Array): Promise<void>;
  has(discId: string, chunkIndex: number): Promise<boolean>;
  stats(discId?: string): Promise<{ chunks: number; bytes: number }>;
  clear(discId?: string): Promise<void>;
}

export interface DiscMetrics {
  discId: string;
  sourceKind: DiscSourceKind;
  discSizeBytes: number;
  chunkSizeBytes: number;
  totalReads: number;
  l1RamHits: number;
  l2OpfsHits: number;
  sourceMisses: number;
  prefetchHits: number;
  bytesFromSource: number;
  bytesFromCache: number;
  ramCachedChunks: number;
  ramCachedBytes: number;
  opfsCachedChunks: number;
  opfsCachedBytes: number;
  avgReadLatencyMs: number;
  lastChunkIndex: number;
  sequentialRun: number;
  peerCount: number;
  recentChunks: number[];
}

export interface Iso9660Metadata {
  validIso9660: boolean;
  volumeId: string;
  systemId: string;
  volumeSizeBytes: number;
  detectedPlatform: 'ps2' | 'ps1' | 'psp' | 'unknown';
  bootFile?: string;
  serial?: string;
  region?: 'NTSC-U' | 'PAL' | 'NTSC-J' | 'UNKNOWN';
  videoMode?: string;
  version?: string;
}

export interface VirtualDiscOptions {
  /** Tamanho de cada chunk de streaming/cache (padrão: 256 KiB). */
  chunkSizeBytes?: number;
  /** Limite máximo do cache L1 em RAM (padrão: 32 MiB — mantém pegada mínima). */
  maxRamCacheBytes?: number;
  /** Máximo de chunks pré-carregados em leitura sequencial (padrão: 6). */
  maxReadAheadChunks?: number;
  /** Cache L2 persistente (ex.: ShardedOpfsChunkCache). */
  persistentCache?: ChunkCacheStore | null;
  /** Callback de telemetria para UI / diagnóstico. */
  onMetrics?: (metrics: DiscMetrics) => void;
}
