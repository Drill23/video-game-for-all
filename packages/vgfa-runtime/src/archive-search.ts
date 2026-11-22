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
  torrentUrl?: string;
  playableDirectly: boolean;
  isCompressed: boolean;
  score: number;
  bestChoice: boolean;
}

const PLAYABLE_DIRECT_EXT = /\.(a26|nes|fds|sfc|smc|md|gen|smd|gb|gbc|gba|z64|n64|v64|iso|chd|cso|zso|bin|cue|pbp|elf)$/i;
const JUNK_FILE_PATTERN = /(preview|image|imgs|boxart|cover|thumb|manual|artwork|onion|garlic|theme|soundtrack|ost|video|movie|screenshot|readme|changelog)/i;

const CONSOLE_EXT_REGEX: Record<string, RegExp> = {
  atari2600: /\.(a26|bin)$/i,
  nes: /\.(nes|fds)$/i,
  snes: /\.(sfc|smc)$/i,
  megadrive: /\.(md|gen|smd|bin)$/i,
  gba: /\.gba$/i,
  n64: /\.(z64|n64|v64)$/i,
  ps1: /\.(chd|bin|cue|iso|pbp)$/i,
  psp: /\.(iso|cso|pbp)$/i,
  ps2: /\.(iso|chd|cso|zso|bin|elf)$/i,
};

const PLATFORM_EXCLUSION_REGEX: Record<string, RegExp> = {
  ps2: /(^|[\/_\-\s])(psp|ps1|psx|ps3|gamecube|wii|dreamcast|xbox|gba|snes|nes|n64)([\/_\-\s]|$)/i,
  psp: /(^|[\/_\-\s])(ps2|ps1|psx|ps3|gamecube|wii|xbox)([\/_\-\s]|$)/i,
  ps1: /(^|[\/_\-\s])(ps2|psp|ps3|gamecube|wii|xbox)([\/_\-\s]|$)/i,
  n64: /(^|[\/_\-\s])(ps2|psp|ps1|psx|gba|snes|nes|gamecube|wii)([\/_\-\s]|$)/i,
  snes: /(^|[\/_\-\s])(ps2|psp|ps1|n64|gba|nes|megadrive|genesis)([\/_\-\s]|$)/i,
  nes: /(^|[\/_\-\s])(ps2|psp|ps1|n64|gba|snes|megadrive|genesis)([\/_\-\s]|$)/i,
  gba: /(^|[\/_\-\s])(ps2|psp|ps1|n64|snes|nes|nds|3ds)([\/_\-\s]|$)/i,
  megadrive: /(^|[\/_\-\s])(ps2|psp|ps1|n64|snes|nes|gba)([\/_\-\s]|$)/i,
  atari2600: /(^|[\/_\-\s])(ps2|psp|ps1|n64|snes|nes|gba)([\/_\-\s]|$)/i,
};

let backendChecked = false;
let backendAvailable = false;
let backendCheckPromise: Promise<boolean> | null = null;

export function getConfiguredRelayUrl(): string {
  try {
    return (localStorage.getItem('vgfa:relay_url') || '').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function setConfiguredRelayUrl(url: string): void {
  try {
    const clean = url.trim().replace(/\/+$/, '');
    if (clean) localStorage.setItem('vgfa:relay_url', clean);
    else localStorage.removeItem('vgfa:relay_url');
  } catch {}
}

/**
 * Detecta automaticamente se existe backend Node local/cloud (/api/health)
 * ou se estamos rodando 100% Serverless (ex.: GitHub Pages grátis para sempre!).
 */
export async function detectVgfaBackend(fetchImpl: typeof fetch = globalThis.fetch): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (backendChecked) return backendAvailable;
  if (backendCheckPromise) return backendCheckPromise;

  backendCheckPromise = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1400);
      const res = await fetchImpl('/api/health', { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (res.ok) {
        const j = (await res.json().catch(() => null)) as { ok?: boolean; service?: string } | null;
        backendAvailable = Boolean(j?.ok && j?.service === 'vgfa-signaling');
      } else {
        backendAvailable = false;
      }
    } catch {
      backendAvailable = false;
    }
    backendChecked = true;
    return backendAvailable;
  })();

  return backendCheckPromise;
}

export function isVgfaBackendOnlineSync(): boolean {
  return backendChecked ? backendAvailable : false;
}

export function toArchiveCorsUrl(rawUrl: string): string {
  const m = /^https?:\/\/archive\.org\/download\/([^/]+)\/(.+)$/i.exec(rawUrl);
  if (m) {
    return `https://cors.archive.org/cors/${m[1]}/${m[2]}`;
  }
  return rawUrl;
}

/**
 * Constrói a URL ideal de streaming/download:
 * 1) Se há backend VGFA local/cloud (/api/proxy/stream) -> Hyper-Stream NVMe HTTP 206!
 * 2) Se usuário configurou um Cloudflare Worker Edge Relay -> HTTP 206 Edge!
 * 3) Modo 100% Serverless (GitHub Pages sem Mac!) -> cors.archive.org direto no navegador!
 */
export function buildProxyStreamUrl(rawUrl: string): string {
  if (rawUrl.startsWith('/api/proxy/stream')) return rawUrl;
  const relay = getConfiguredRelayUrl();
  if (relay) {
    return `${relay}/?url=${encodeURIComponent(rawUrl)}`;
  }
  // Em testes Node ou quando backend está confirmado ativo, usa /api/proxy/stream
  if (typeof window === 'undefined' || !backendChecked || backendAvailable) {
    return `/api/proxy/stream?url=${encodeURIComponent(rawUrl)}`;
  }
  return toArchiveCorsUrl(rawUrl);
}

/**
 * Smart Find 100% Serverless (direto do navegador para archive.org CORS-enabled!)
 * usado automaticamente no GitHub Pages quando não há servidor backend.
 */
async function smartFindDirectBrowser(
  query: string,
  consoleId?: ConsoleId,
  serial?: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ options: SmartFindOption[]; note?: string }> {
  const sanitized = query.trim().replace(/[()"]/g, ' ');
  const serialParam = (serial || '').trim().toUpperCase();
  const serialCompact = serialParam.replace(/[^A-Z0-9]/g, '');
  const preferredExt = (consoleId && CONSOLE_EXT_REGEX[consoleId]) || PLAYABLE_DIRECT_EXT;
  const excludeOtherPlatform = consoleId ? PLATFORM_EXCLUSION_REGEX[consoleId] : undefined;

  const runSearch = async (expr: string, rows = 8) => {
    const p = new URLSearchParams({
      q: expr,
      'fl[]': 'identifier,title,year,downloads',
      'sort[]': 'downloads desc',
      rows: String(rows),
      page: '1',
      output: 'json',
    });
    const r = await fetchImpl(`https://archive.org/advancedsearch.php?${p.toString()}`);
    if (!r.ok) return [] as Array<{ identifier: string; title?: string }>;
    const j = (await r.json()) as { response?: { docs?: Array<{ identifier: string; title?: string }> } };
    return j.response?.docs ?? [];
  };

  const queries: Array<Promise<Array<{ identifier: string; title?: string }>>> = [
    runSearch(`(${sanitized}) AND mediatype:software AND NOT access-restricted-item:true`, 10),
  ];
  if (serialParam.length >= 6) {
    queries.push(runSearch(`("${serialParam}" OR "${serialCompact}") AND NOT access-restricted-item:true`, 6));
  }
  const baseClean = sanitized.replace(/\b(ps2|ps1|psp|n64|snes|nes|gba|atari|mega drive|playstation 2)\b/gi, '').trim();
  if (baseClean.length >= 3 && baseClean !== sanitized) {
    queries.push(runSearch(`(${baseClean}) AND (${consoleId || 'rom'}) AND NOT access-restricted-item:true`, 6));
  }

  const lists = await Promise.all(queries.map((q) => q.catch(() => [])));
  const seen = new Set<string>();
  const docs: Array<{ identifier: string; title?: string }> = [];
  for (const list of lists) {
    for (const d of list) {
      if (!seen.has(d.identifier)) {
        seen.add(d.identifier);
        docs.push(d);
      }
    }
  }

  const queryTokens = sanitized
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !['the', 'and', 'for', 'ps2', 'ps1', 'psp', 'n64', 'snes', 'nes', 'gba', 'atari', 'usa'].includes(w));

  const inspected = await Promise.all(
    docs.slice(0, 8).map(async (doc) => {
      try {
        const mr = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`);
        if (!mr.ok) return [] as SmartFindOption[];
        const data = (await mr.json()) as {
          metadata?: { access_restricted_item?: string };
          files?: Array<{ name: string; size?: string | number; private?: string | boolean }>;
        };
        if (String(data.metadata?.access_restricted_item || '').toLowerCase() === 'true') return [];

        const torrentFile = (data.files ?? []).find((f) => /\.torrent$/i.test(f.name));
        const torrentUrl = torrentFile
          ? `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(torrentFile.name)}`
          : undefined;

        return (data.files ?? [])
          .filter((f) => {
            if (f.private === true || f.private === 'true') return false;
            if (JUNK_FILE_PATTERN.test(f.name)) return false;
            if (excludeOtherPlatform && excludeOtherPlatform.test(f.name)) return false;
            if (consoleId && CONSOLE_EXT_REGEX[consoleId]) {
              if (!preferredExt.test(f.name)) return false;
            } else if (!PLAYABLE_DIRECT_EXT.test(f.name)) {
              return false;
            }
            if ((data.files?.length ?? 0) > 15 && queryTokens.length > 0) {
              const lower = f.name.toLowerCase();
              if (!queryTokens.some((tok) => lower.includes(tok))) return false;
            }
            return true;
          })
          .slice(0, 4)
          .map((f) => {
            const size = Number(f.size ?? 0);
            const lower = f.name.toLowerCase();
            const compact = f.name.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const tokenHits = queryTokens.filter((tok) => lower.includes(tok)).length;
            const matchesConsole = preferredExt.test(f.name);
            const matchesSerial = serialCompact.length >= 6 && compact.includes(serialCompact);
            const isPtBr = /(pt[-_\s]?br|portugu|dublad|legend)/i.test(f.name);
            const rawUrl = `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(f.name)}`;
            const score =
              (matchesConsole ? 120 : 60) +
              (matchesSerial ? 180 : 0) +
              (isPtBr ? 35 : 0) +
              tokenHits * 40 +
              (size > 0 && size < 8_600_000_000 ? 15 : 0);
            return {
              identifier: doc.identifier,
              itemTitle: doc.title || doc.identifier,
              filename: f.name,
              size,
              url: rawUrl,
              proxyUrl: buildProxyStreamUrl(rawUrl),
              torrentUrl,
              playableDirectly: true,
              isCompressed: false,
              score,
              bestChoice: false,
            };
          });
      } catch {
        return [] as SmartFindOption[];
      }
    }),
  );

  const ranked = inspected
    .flat()
    .sort((a, b) => b.score - a.score || a.size - b.size)
    .slice(0, 8)
    .map((item, idx) => ({ ...item, bestChoice: idx === 0 }));

  return {
    options: ranked,
    note:
      ranked.length === 0
        ? 'Nenhuma cópia pública aberta encontrada no momento. Selecione o arquivo no seu dispositivo para jogar imediatamente.'
        : undefined,
  };
}

/**
 * Busca inteligente em 1 passo (híbrida: usa /api/archive/smart-find se há backend
 * ou pesquisa 100% Serverless direto no navegador no GitHub Pages!).
 */
export async function smartFindGameOptions(
  query: string,
  consoleId?: ConsoleId,
  serial?: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ options: SmartFindOption[]; note?: string }> {
  const clean = query.trim();
  if (!clean || typeof window === 'undefined') return { options: [] };

  const hasBackend = await detectVgfaBackend(fetchImpl);
  if (hasBackend) {
    const params = new URLSearchParams({ q: clean });
    if (consoleId) params.set('console', consoleId);
    if (serial) params.set('serial', serial);
    try {
      const res = await fetchImpl(`/api/archive/smart-find?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as { options?: SmartFindOption[]; note?: string };
        return { options: data.options ?? [], note: data.note };
      }
    } catch {
      // Cai para busca direta serverless
    }
  }

  return smartFindDirectBrowser(clean, consoleId, serial, fetchImpl);
}

/**
 * Pesquisa ao vivo no Internet Archive (híbrida backend / serverless).
 */
export async function searchInternetArchive(
  query: string,
  consoleId?: ConsoleId,
  limit = 12,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ArchiveSearchResult[]> {
  const clean = query.trim();
  if (!clean) return [];

  if (typeof window !== 'undefined' && (await detectVgfaBackend(fetchImpl))) {
    const params = new URLSearchParams({
      q: clean,
      limit: String(Math.min(24, Math.max(1, limit))),
    });
    if (consoleId) params.set('console', consoleId);
    const res = await fetchImpl(`/api/archive/search?${params.toString()}`);
    if (res.ok) {
      const json = (await res.json()) as { results?: Omit<ArchiveSearchResult, 'consoleHint'>[] };
      return (json.results ?? []).map((r) => ({
        ...r,
        consoleHint: consoleId ?? 'ps2',
      }));
    }
  }

  const fallbackParams = new URLSearchParams({
    q: `(${clean.replace(/[()"]/g, ' ')}) AND mediatype:software AND NOT access-restricted-item:true`,
    'fl[]': 'identifier,title,creator,year,collection,downloads',
    'sort[]': 'downloads desc',
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

export async function listArchiveItemFiles(
  identifier: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ restricted: boolean; files: ArchivePlayableFile[] }> {
  if (typeof window !== 'undefined' && (await detectVgfaBackend(fetchImpl))) {
    const res = await fetchImpl(`/api/archive/files?id=${encodeURIComponent(identifier)}`);
    if (res.ok) {
      const data = (await res.json()) as { restricted?: boolean; files?: ArchivePlayableFile[] };
      return { restricted: Boolean(data.restricted), files: data.files ?? [] };
    }
  }

  const res = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  if (!res.ok) throw new Error(`Falha ao consultar arquivos (HTTP ${res.status})`);
  const data = (await res.json()) as {
    metadata?: { access_restricted_item?: string };
    files?: Array<{ name: string; size?: string | number; private?: string | boolean }>;
  };
  const restricted = String(data.metadata?.access_restricted_item || '').toLowerCase() === 'true';
  const files: ArchivePlayableFile[] = restricted
    ? []
    : (data.files ?? [])
        .filter((f) => !(f.private === true || f.private === 'true') && !JUNK_FILE_PATTERN.test(f.name) && PLAYABLE_DIRECT_EXT.test(f.name))
        .map((f) => {
          const rawUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(f.name)}`;
          return {
            name: f.name,
            size: Number(f.size ?? 0),
            url: rawUrl,
            proxyUrl: buildProxyStreamUrl(rawUrl),
            isPrivate: false,
            isCompressed: false,
            playableDirectly: true,
          };
        });
  return { restricted, files };
}
