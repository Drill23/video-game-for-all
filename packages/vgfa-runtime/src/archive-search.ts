import type { ConsoleId } from '@vgfa/pad';

export interface ArchiveSearchResult {
  identifier: string;
  title: string;
  creator?: string;
  year?: string;
  consoleHint: ConsoleId;
  detailsUrl: string;
  thumbnailUrl: string;
  collection: string;
}

const CONSOLE_COLLECTIONS: Partial<Record<ConsoleId, string>> = {
  atari2600: 'atari_2600_library',
  nes: 'internetarcade',
  snes: 'consolelivingroom',
  megadrive: 'sega_genesis_library',
  gba: 'consolelivingroom',
  n64: 'consolelivingroom',
  ps1: 'consolelivingroom',
  psp: 'softwarelibrary',
  ps2: 'softwarelibrary',
};

/**
 * Pesquisa ao vivo no acervo público do Internet Archive (sem precisar armazenar arquivos no servidor).
 * Retorna itens públicos com links de metadados e suporte a leitura de arquivos compatíveis.
 */
export async function searchInternetArchive(
  query: string,
  consoleId?: ConsoleId,
  limit = 12,
  fetchImpl: typeof fetch = fetch,
): Promise<ArchiveSearchResult[]> {
  const clean = query.trim();
  if (!clean) return [];

  const collection = consoleId ? CONSOLE_COLLECTIONS[consoleId] : undefined;
  const colClause = collection
    ? `collection:(${collection} OR consolelivingroom OR homebrew)`
    : 'mediatype:software';

  const q = `(${clean.replace(/[()"]/g, ' ')}) AND ${colClause}`;
  const params = new URLSearchParams({
    q,
    'fl[]': 'identifier,title,creator,year,collection',
    rows: String(Math.min(24, Math.max(1, limit))),
    page: '1',
    output: 'json',
  });

  const url = `https://archive.org/advancedsearch.php?${params.toString()}`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Internet Archive retornou HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    response?: {
      docs?: Array<{
        identifier: string;
        title?: string;
        creator?: string | string[];
        year?: string | number;
        collection?: string | string[];
      }>;
    };
  };

  const docs = json.response?.docs ?? [];
  return docs.map((d) => {
    const col = Array.isArray(d.collection) ? d.collection[0] : (d.collection ?? 'software');
    return {
      identifier: d.identifier,
      title: d.title || d.identifier,
      creator: Array.isArray(d.creator) ? d.creator[0] : d.creator,
      year: d.year ? String(d.year) : undefined,
      consoleHint: consoleId ?? 'atari2600',
      detailsUrl: `https://archive.org/details/${encodeURIComponent(d.identifier)}`,
      thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
      collection: col,
    };
  });
}

export interface ArchivePlayableFile {
  name: string;
  size: number;
  url: string;
}

/**
 * Inspeciona os arquivos dentro de um item do Internet Archive e lista ROMs/ISOs suportadas
 * prontas para streaming via HTTP Range (CORS habilitado no archive.org!).
 */
export async function listArchiveFiles(
  identifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ArchivePlayableFile[]> {
  const res = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    files?: Array<{ name: string; size?: string | number }>;
  };
  const exts = /\.(a26|nes|sfc|smc|md|gen|gb|gbc|gba|z64|n64|v64|iso|chd|cso|bin|zip)$/i;
  return (data.files ?? [])
    .filter((f) => exts.test(f.name))
    .map((f) => ({
      name: f.name,
      size: Number(f.size ?? 0),
      url: `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(f.name)}`,
    }))
    .sort((a, b) => a.size - b.size);
}
