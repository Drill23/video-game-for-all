import {
  HttpRangeSource,
  LocalFileSource,
  ShardedOpfsChunkCache,
  VirtualChunkedDisc,
  createSabDiscBuffer,
  inspectIso9660,
  type DiscMetrics,
  type Iso9660Metadata,
  type SabDiscBuffer,
} from '@vgfa/disc';
import type { PadState } from '@vgfa/pad';
import { buildProxyStreamUrl } from './archive-search.js';

export interface WebGpuCapabilities {
  webgpuSupported: boolean;
  adapterName: string;
  dualSourceBlending: boolean;
  sharedArrayBuffer: boolean;
  crossOriginIsolated: boolean;
  opfsSupported: boolean;
  jspiSupported: boolean;
  wasmSimdSupported: boolean;
  readinessScore: number; // 0..100
  notes: string[];
}

interface NavigatorWithGpu {
  gpu?: {
    requestAdapter(opts?: { powerPreference?: string }): Promise<{
      features: Set<string>;
      info?: { vendor?: string; architecture?: string; description?: string };
    } | null>;
  };
}

/**
 * Detecta todas as capacidades reais exigidas pelo motor VGFA-PS2 / PSP no navegador:
 * WebGPU, dual-source-blending, SharedArrayBuffer (COOP/COEP), OPFS Sharded Cache, JSPI e WASM SIMD.
 */
export async function probePs2WebCapabilities(): Promise<WebGpuCapabilities> {
  const notes: string[] = [];
  const crossOriginIsolated = typeof globalThis.crossOriginIsolated === 'boolean'
    ? globalThis.crossOriginIsolated
    : false;
  const sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
  const opfsSupported = ShardedOpfsChunkCache.isSupported();
  const jspiSupported =
    typeof WebAssembly !== 'undefined' &&
    'Suspending' in WebAssembly &&
    'promising' in WebAssembly;

  let wasmSimdSupported = false;
  try {
    // Módulo WASM padrão (wasm-feature-detect) para testar suporte real a SIMD128
    wasmSimdSupported =
      typeof WebAssembly !== 'undefined' &&
      WebAssembly.validate(
        new Uint8Array([
          0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0,
          253, 15, 253, 98, 11,
        ]),
      );
  } catch {
    wasmSimdSupported = false;
  }

  let webgpuSupported = false;
  let dualSourceBlending = false;
  let adapterName = 'Indisponível';

  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as
    | NavigatorWithGpu
    | undefined;

  if (nav?.gpu) {
    try {
      const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        webgpuSupported = true;
        dualSourceBlending = adapter.features.has('dual-source-blending');
        const info = adapter.info;
        adapterName =
          info?.description ||
          [info?.vendor, info?.architecture].filter(Boolean).join(' ') ||
          'Adaptador WebGPU Ativo';
      }
    } catch {
      notes.push('Falha ao requisitar adaptador WebGPU.');
    }
  } else {
    notes.push('WebGPU indisponível neste navegador (use Chrome/Edge recente ou Safari moderno).');
  }

  if (!crossOriginIsolated || !sharedArrayBuffer) {
    notes.push('Headers COOP/COEP ausentes: SharedArrayBuffer multi-thread desativado.');
  }
  if (!dualSourceBlending && webgpuSupported) {
    notes.push('dual-source-blending ausente: modo de fallback software blend necessário.');
  }
  if (opfsSupported) {
    notes.push('Cache L2 Sharded OPFS ativo (sem limite monolítico de 2 GB).');
  }

  let score = 0;
  if (webgpuSupported) score += 35;
  if (sharedArrayBuffer && crossOriginIsolated) score += 25;
  if (opfsSupported) score += 15;
  if (wasmSimdSupported) score += 10;
  if (dualSourceBlending) score += 10;
  if (jspiSupported) score += 5;

  return {
    webgpuSupported,
    adapterName,
    dualSourceBlending,
    sharedArrayBuffer,
    crossOriginIsolated,
    opfsSupported,
    jspiSupported,
    wasmSimdSupported,
    readinessScore: score,
    notes,
  };
}

export interface Ps2MountedSession {
  disc: VirtualChunkedDisc;
  metadata: Iso9660Metadata;
  sabBuffer: SabDiscBuffer | null;
  benchmarkRandomReadMs: number;
  benchmarkWarmCacheMs: number;
  pushPadState(state: PadState): void;
  getLatestPadState(): PadState | null;
  dispose(): Promise<void>;
}

/**
 * Monta qualquer ISO de PS2/PSP (arquivo local ou URL HTTP Range) no motor VGFA-Disc
 * sem carregar a ISO na RAM, extrai Serial/Região/Boot ELF do SYSTEM.CNF em milissegundos
 * e prepara a ponte SharedArrayBuffer + DualShock 2 para o core WebGPU/WASM.
 */
export async function mountPs2DiscSession(
  input: { kind: 'file'; file: File } | { kind: 'url'; url: string; name?: string },
  onMetrics?: (m: DiscMetrics) => void,
): Promise<Ps2MountedSession> {
  const source =
    input.kind === 'file'
      ? new LocalFileSource(input.file, input.file.name)
      : await HttpRangeSource.open(
          typeof window !== 'undefined' && /^https?:\/\//i.test(input.url)
            ? buildProxyStreamUrl(input.url)
            : input.url,
          { name: input.name ?? decodeURIComponent(input.url.split('/').pop()?.split('?')[0] || 'disc.iso') },
        );

  const opfsCache = ShardedOpfsChunkCache.isSupported()
    ? new ShardedOpfsChunkCache(384 * 1024 * 1024)
    : null;

  const disc = new VirtualChunkedDisc(source, {
    chunkSizeBytes: 256 * 1024,
    maxRamCacheBytes: 32 * 1024 * 1024,
    maxReadAheadChunks: 6,
    persistentCache: opfsCache,
    onMetrics,
  });

  const t0 = performance.now();
  const metadata = await inspectIso9660(disc);
  const benchmarkRandomReadMs = Math.max(0.01, performance.now() - t0);

  // Medição warm-cache (lendo novamente o PVD do L1/L2)
  const t1 = performance.now();
  if (disc.size >= 34816) {
    await disc.read(32768, 2048);
  }
  const benchmarkWarmCacheMs = Math.max(0.01, performance.now() - t1);

  const sabBuffer =
    typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated
      ? createSabDiscBuffer(1024 * 1024)
      : null;

  let latestPad: PadState | null = null;

  return {
    disc,
    metadata,
    sabBuffer,
    benchmarkRandomReadMs,
    benchmarkWarmCacheMs,
    pushPadState(state: PadState) {
      latestPad = state;
      // Também expõe na janela global para cores WASM AOT/JIT plugados dinamicamente
      if (typeof globalThis !== 'undefined') {
        (globalThis as Record<string, unknown>).__VGFA_PAD_STATE__ = state;
      }
    },
    getLatestPadState() {
      return latestPad;
    },
    async dispose() {
      await disc.close();
    },
  };
}
