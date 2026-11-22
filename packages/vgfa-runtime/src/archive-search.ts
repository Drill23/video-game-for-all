import type { ConsoleId } from '@vgfa/pad';

export interface ArchiveSearchResult {
  identifier: string;
  title: string;
  creator?: string;
  year?: string;
  downloads?: number;
  consoleHint: ConsoleId;
  detailsUrl: string;
  thumbnailUrl: string;
  collection: string;
}

export interface ArchivePlayableFile {
  name: string;
  size: number;
  url: string;
  proxyUrl: string;
  isPrivate: boolean;
  isCompressed: boolean;
  playableDirectly: boolean;
  warning?: string;
}

export interface SmartFindOption {
  identifier: string;
  itemTitle: string;
  filename: string;
  size: number;
  url: string;
  proxyUrl: string;
  playableDirectly: boolean;
  isCompressed: boolean;
  score: number;
  bestChoice: boolean;
}

/**
 * Busca inteligente em 1 passo: pesquisa no acervo público, inspeciona em paralelo,
 * filtra bloqueados/privados e já destaca a ⭐ Melhor Opção pronta para jogar no navegador!
 */
export async function smartFindGameOptions(
  query: string,
  consoleId?: ConsoleId,
  fetchImpl: typeof fetch = fetch,
): Promise<{ options: SmartFindOption[]; note?: string }> {
  const clean = query.trim();
  if (!clean || typeof window === 'undefined') return { options: [] };
  const params = new URLSearchParams({ q: clean });
  if (consoleId) params.set('console', consoleId);
  const res = await fetchImpl(`/api/archive/smart-find?${params.toString()}`);
  if (!res.ok) return { options: [], note: 'Acervo temporariamente indisponível.' };
  const data = (await res.json()) as { options?: SmartFindOption[]; note?: string };
  return { options: data.options ?? [], note: data.note };
}

export function buildProxyStreamUrl(rawUrl: string): string {
  if (rawUrl.startsWith('/api/proxy/stream')) return rawUrl;
  return `/api/proxy/stream?url=${encodeURIComponent(rawUrl)}`;
}

/**
 * Pesquisa ao vivo no Internet Archive usando o proxy CORS-free local (/api/archive/search),
 * eliminando bloqueios CORS/COEP e ordenando pelos itens mais relevantes.
 */
export async function searchInternetArchive(
  query: string,
  consoleId?: ConsoleId,
  limit = 12,
  fetchImpl: typeof fetch = fetch,
): Promise<ArchiveSearchResult[]> {
  const clean = query.trim();
  if (!clean) return [];

  const params = new URLSearchParams({
    q: clean,
    limit: String(Math.min(24, Math.max(1, limit))),
  });
  if (consoleId) params.set('console', consoleId);

  // No navegador usa o endpoint do nosso servidor local (sem bloqueio CORS/COEP)
  if (typeof window !== 'undefined') {
    const res = await fetchImpl(`/api/archive/search?${params.toString()}`);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(errBody.error || `Falha na busca (HTTP ${res.status})`);
    }
    const json = (await res.json()) as { results?: Omit<ArchiveSearchResult, 'consoleHint'>[] };
    return (json.results ?? []).map((r) => ({
      ...r,
      consoleHint: consoleId ?? 'ps2',
    }));
  }

  // Fallback direto fora do navegador (ex.: testes Node)
  const fallbackParams = new URLSearchParams({
    q: `(${clean.replace(/[()"]/g, ' ')}) AND mediatype:software`,
    'fl[]': 'identifier,title,creator,year,collection,downloads',
    rows: String(limit),
    page: '1',
    output: 'json',
  });
  const res = await fetchImpl(`https://archive.org/advancedsearch.php?${fallbackParams.toString()}`);
  if (!res.ok) throw new Error(`Internet Archive retornou HTTP ${res.status}`);
  const data = (await res.json()) as {
    response?: {
      docs?: Array<{
        identifier: string;
        title?: string;
        creator?: string | string[];
        year?: string | number;
        collection?: string | string[];
        downloads?: number;
      }>;
    };
  };
  return (data.response?.docs ?? []).map((d) => ({
    identifier: d.identifier,
    title: d.title || d.identifier,
    creator: Array.isArray(d.creator) ? d.creator[0] : d.creator,
    year: d.year ? String(d.year) : undefined,
    downloads: d.downloads ?? 0,
    consoleHint: consoleId ?? 'ps2',
    detailsUrl: `https://archive.org/details/${encodeURIComponent(d.identifier)}`,
    thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
    collection: Array.isArray(d.collection) ? d.collection[0] : (d.collection ?? 'software'),
  }));
}

/**
 * Lista arquivos do item no Internet Archive com validação clara de:
 * - playableDirectly (ROM/ISO direta pronta para streaming/play)
 * - isCompressed (.zip/.7z grande que exige extração)
 * - isPrivate (item restrito/login obrigatório na origem)
 */
export async function listArchiveFiles(
  identifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ restricted: boolean; files: ArchivePlayableFile[] }> {
  if (typeof window !== 'undefined') {
    const res = await fetchImpl(`/api/archive/files?id=${encodeURIComponent(identifier)}`);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(errBody.error || `Falha ao listar arquivos (HTTP ${res.status})`);
    }
    const data = (await res.json()) as { restricted?: boolean; files?: ArchivePlayableFile[] };
    return { restricted: Boolean(data.restricted), files: data.files ?? [] };
  }

  return { restricted: false, files: [] };
}
