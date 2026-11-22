import type { DiscSource } from './types.js';

const RETRY_DELAYS_MS = [150, 450, 1200];

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseContentRangeTotal(header: string | null): number | null {
  if (!header) return null;
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+)$/.exec(header.trim());
  if (!m) return null;
  return Number(m[3]);
}

function hashUrl(url: string): string {
  let h = 2166136261;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export interface HttpRangeOptions {
  timeoutMs?: number;
  name?: string;
  id?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Fonte HTTP Range Sob Demanda (`Range: bytes=start-end`).
 *
 * Segue a lição aprendida da Fase 0:
 * - Valida suporte a HTTP 206 pedindo apenas o byte 0 (`bytes=0-0`).
 * - Se o servidor responder 200 (ignorando Range), cancela o stream imediatamente
 *   para nunca baixar uma ISO de 4 GB inteira na memória do navegador.
 */
export class HttpRangeSource implements DiscSource {
  readonly kind = 'http-range' as const;
  readonly id: string;
  readonly name: string;
  readonly size: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  private constructor(
    public readonly url: string,
    size: number,
    name: string,
    id: string,
    timeoutMs: number,
    fetchImpl: typeof fetch,
  ) {
    this.size = size;
    this.name = name;
    this.id = id;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  static async open(url: string, options: HttpRangeOptions = {}): Promise<HttpRangeSource> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? 12_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchImpl(url, {
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store',
        signal: controller.signal,
      });

      const total = res.status === 206 ? parseContentRangeTotal(res.headers.get('Content-Range')) : null;
      if (!total) {
        await res.body?.cancel().catch(() => {});
        if (res.status === 200) {
          throw new Error(
            'O servidor não suporta HTTP Byte Ranges (retornou 200 em vez de 206). Não é possível fazer streaming sob demanda.',
          );
        }
        throw new Error(`Falha ao abrir disco remoto HTTP ${res.status} (${url})`);
      }

      await res.arrayBuffer().catch(() => null);
      const parsed = new URL(url, 'http://localhost');
      const fallbackName = decodeURIComponent(parsed.pathname.split('/').pop() || 'remote-disc.iso');
      const id = options.id ?? `http_${hashUrl(url)}_${total}`;
      return new HttpRangeSource(url, total, options.name ?? fallbackName, id, timeoutMs, fetchImpl);
    } finally {
      clearTimeout(timer);
    }
  }

  async readRaw(offset: number, length: number, externalSignal?: AbortSignal): Promise<Uint8Array> {
    if (offset >= this.size || length <= 0) return new Uint8Array(0);
    const clampedEnd = Math.min(this.size - 1, offset + length - 1);
    const expectedLen = clampedEnd - offset + 1;

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const onExternalAbort = () => controller.abort();
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      let lastErr: Error | null = null;
      try {
        const res = await this.fetchImpl(this.url, {
          headers: { Range: `bytes=${offset}-${clampedEnd}` },
          cache: 'no-store',
          signal: controller.signal,
        });

        if (res.status === 416) {
          return new Uint8Array(0);
        }
        if (res.status === 206) {
          const ab = await res.arrayBuffer();
          return new Uint8Array(ab, 0, Math.min(ab.byteLength, expectedLen));
        }

        await res.body?.cancel().catch(() => {});
        lastErr = new Error(`HTTP ${res.status} ao ler bytes ${offset}-${clampedEnd}`);
        if (!isRetryableStatus(res.status)) {
          throw lastErr;
        }
      } catch (err) {
        if (externalSignal?.aborted) {
          throw new Error('Leitura de disco cancelada.');
        }
        lastErr = err instanceof Error ? err : new Error(String(err));
      } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', onExternalAbort);
      }

      if (attempt >= RETRY_DELAYS_MS.length) {
        throw lastErr ?? new Error('Erro desconhecido ao ler disco remoto.');
      }
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}
