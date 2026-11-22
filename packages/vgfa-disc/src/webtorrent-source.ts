import type { DiscSource } from './types.js';

/**
 * Interface mínima compatível com WebTorrent no navegador (WebRTC P2P).
 * Permite plugar qualquer instância WebTorrent (CDN ou bundle) ou mock em testes,
 * mantendo o pacote @vgfa/disc 100% leve e sem dependências Node quebradas no browser.
 */
export interface WebTorrentFileLike {
  name: string;
  length: number;
  offset?: number;
  createReadStream?(opts: { start: number; end: number }): AsyncIterable<Uint8Array>;
  getBuffer?(cb: (err: Error | null, buf?: Uint8Array) => void): void;
}

export interface WebTorrentInstanceLike {
  infoHash: string;
  name: string;
  pieceLength: number;
  numPeers: number;
  files: WebTorrentFileLike[];
  select?(startPiece: number, endPiece: number, priority?: number, notify?: () => void): void;
  deselect?(startPiece: number, endPiece: number, priority?: number): void;
  destroy?(cb?: () => void): void;
}

export interface WebTorrentSourceOptions {
  /** Fallback HTTP Range (WebSeed BEP-19) caso o enxame WebRTC esteja frio ou sem peers. */
  webSeedFallback?: DiscSource | null;
  /** Tempo máximo esperando peers WebRTC antes de acionar o WebSeed (ms). */
  p2pTimeoutMs?: number;
}

/**
 * Fonte P2P WebRTC (WebTorrent) com Priorização por Setor (Random-Access Piece Prioritization).
 *
 * Diferente de streaming sequencial de filmes (Lume TV), jogos de console fazem leituras
 * aleatórias no disco. Quando o emulador pede (offset, length):
 * 1. Mapeamos exatamente os pieces [startPiece .. endPiece] no torrent;
 * 2. Elevamos a prioridade desses pieces (select(..., 100)) no enxame WebRTC;
 * 3. Lemos apenas o intervalo pedido;
 * 4. Se não houver peers WebRTC ativos em tempo hábil, caímos suavemente para o WebSeed HTTP Range.
 */
export class WebTorrentDiscSource implements DiscSource {
  readonly kind = 'webtorrent' as const;
  readonly id: string;
  readonly name: string;
  readonly size: number;
  private readonly fileOffset: number;
  private readonly webSeedFallback: DiscSource | null;
  private readonly p2pTimeoutMs: number;

  constructor(
    private readonly torrent: WebTorrentInstanceLike,
    private readonly file: WebTorrentFileLike,
    options: WebTorrentSourceOptions = {},
  ) {
    this.id = `wt_${torrent.infoHash.slice(0, 16)}_${file.length}`;
    this.name = file.name;
    this.size = file.length;
    this.fileOffset = file.offset ?? 0;
    this.webSeedFallback = options.webSeedFallback ?? null;
    this.p2pTimeoutMs = options.p2pTimeoutMs ?? 4_000;
  }

  getPeerCount(): number {
    return this.torrent.numPeers ?? 0;
  }

  async readRaw(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    if (offset >= this.size || length <= 0) return new Uint8Array(0);
    const end = Math.min(this.size - 1, offset + length - 1);
    const expectedLen = end - offset + 1;

    // Se há WebSeed e nenhum peer WebRTC conectado, atende instantaneamente via WebSeed
    if (this.webSeedFallback && this.getPeerCount() === 0) {
      return this.webSeedFallback.readRaw(offset, expectedLen, signal);
    }

    const pieceLen = Math.max(16384, this.torrent.pieceLength || 262144);
    const absStart = this.fileOffset + offset;
    const absEnd = this.fileOffset + end;
    const startPiece = Math.floor(absStart / pieceLen);
    const endPiece = Math.floor(absEnd / pieceLen);

    // Prioriza os pieces exatos necessários pela CPU do console
    this.torrent.select?.(startPiece, endPiece, 100);

    try {
      if (typeof this.file.createReadStream === 'function') {
        const p2pRead = this.readFromStream(offset, end, expectedLen, signal);
        if (!this.webSeedFallback) {
          return await p2pRead;
        }
        // Corrida inteligente: P2P WebRTC vs timeout para WebSeed fallback
        return await Promise.race([
          p2pRead,
          new Promise<Uint8Array>((resolve, reject) => {
            const t = setTimeout(() => {
              this.webSeedFallback!.readRaw(offset, expectedLen, signal).then(resolve, reject);
            }, this.p2pTimeoutMs);
            p2pRead.finally(() => clearTimeout(t));
          }),
        ]);
      }

      if (this.webSeedFallback) {
        return await this.webSeedFallback.readRaw(offset, expectedLen, signal);
      }

      throw new Error('Fonte WebTorrent não expõe createReadStream() nem WebSeed fallback.');
    } finally {
      this.torrent.deselect?.(startPiece, endPiece, 100);
    }
  }

  private async readFromStream(
    start: number,
    end: number,
    expectedLen: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const out = new Uint8Array(expectedLen);
    let cursor = 0;
    const stream = this.file.createReadStream!({ start, end });
    for await (const chunk of stream) {
      if (signal?.aborted) {
        throw new Error('Leitura P2P cancelada.');
      }
      const take = Math.min(chunk.byteLength, expectedLen - cursor);
      out.set(chunk.subarray(0, take), cursor);
      cursor += take;
      if (cursor >= expectedLen) break;
    }
    return cursor === expectedLen ? out : out.subarray(0, cursor);
  }

  close(): void {
    this.torrent.destroy?.();
  }
}

/**
 * Seleciona automaticamente o maior arquivo de disco (.iso/.bin/.chd/.cso/.rom) dentro de um torrent.
 */
export function pickPrimaryDiscFile(files: WebTorrentFileLike[]): WebTorrentFileLike | null {
  if (!files.length) return null;
  const preferredExt = /\.(iso|chd|cso|zso|bin|img|nes|sfc|smc|gba|z64|n64|md|a26)$/i;
  const matching = files.filter((f) => preferredExt.test(f.name));
  const pool = matching.length > 0 ? matching : files;
  return pool.reduce((best, cur) => (cur.length > best.length ? cur : best), pool[0]);
}
