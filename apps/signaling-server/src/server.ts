import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const DEFAULT_PORT = Number(process.env.VGFA_SIGNALING_PORT || 8787);
const WEB_PORT = Number(process.env.VGFA_WEB_PORT || 5173);

interface PadPeer {
  peerId: string;
  slot: number;
  label: string;
  ws: WebSocket;
}

interface Room {
  code: string;
  hostWs: WebSocket;
  consoleId: string;
  gameTitle: string;
  pads: Map<string, PadPeer>;
  createdAt: number;
}

const PLAYABLE_DIRECT_EXT = /\.(a26|nes|fds|sfc|smc|md|gen|smd|gb|gbc|gba|z64|n64|v64|iso|chd|cso|zso|bin|cue|pbp|elf)$/i;
const ARCHIVE_COMPRESSED_EXT = /\.(zip|7z|rar)$/i;
const JUNK_FILE_PATTERN = /(preview|image|imgs|boxart|cover|thumb|manual|artwork|onion|garlic|theme|soundtrack|ost|video|movie|screenshot|readme|changelog)/i;

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

const CONSOLE_EXT_REGEX: Record<string, RegExp> = {
  atari2600: /\.(a26|bin)$/i,
  nes: /\.(nes|fds)$/i,
  snes: /\.(sfc|smc)$/i,
  megadrive: /\.(md|gen|smd|bin)$/i,
  gba: /\.(gba|gb|gbc)$/i,
  n64: /\.(z64|n64|v64)$/i,
  ps1: /\.(chd|cue|bin|pbp|iso)$/i,
  psp: /\.(iso|cso|pbp)$/i,
  ps2: /\.(iso|chd|cso|zso|bin|elf)$/i,
};

async function verifyUrlReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'VGFA-Probe/0.3' },
      redirect: 'follow',
      signal: AbortSignal.timeout(3_000),
    });
    return res.status === 200 || res.status === 206;
  } catch {
    return false;
  }
}

function isAllowedProxyTarget(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    // Bloqueia endereços de metadados de nuvem
    if (parsed.hostname === '169.254.169.254') return null;
    return parsed;
  } catch {
    return null;
  }
}

const PS2_CORE_CACHE_DIR = path.join(os.tmpdir(), 'vgfa-ps2-core-cache');
const ALLOWED_PS2_CORE_FILES: Record<string, string> = {
  'Play.js': 'application/javascript; charset=utf-8',
  'Play.wasm': 'application/wasm',
};

/**
 * Serve os artefatos BSD-2-Clause do motor PS2 Zero-BIOS (Play.js + Play.wasm)
 * em mesma origem (com COOP/COEP/CORP) com cache local em disco após o 1º uso.
 * Isso elimina o bloqueio de iframe cross-origin no Safari/Chrome e permite injetar
 * o nosso @vgfa/disc (streaming HTTP Range) + Celular DualShock 2 direto no núcleo PS2!
 */
async function handlePs2CoreAsset(res: http.ServerResponse, filename: string): Promise<void> {
  const mime = ALLOWED_PS2_CORE_FILES[filename];
  if (!mime) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Arquivo do núcleo PS2 não encontrado.' }));
    return;
  }

  const localPath = path.join(PS2_CORE_CACHE_DIR, filename);
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=86400',
  };

  try {
    const cached = await fs.readFile(localPath);
    headers['Content-Length'] = String(cached.byteLength);
    res.writeHead(200, headers);
    res.end(cached);
    return;
  } catch {
    // Ainda não está em cache; busca uma vez e grava em disco
  }

  try {
    const upstream = await fetch(`https://playjs.purei.org/${filename}`, {
      headers: { 'User-Agent': 'VGFA-PS2Core/0.4' },
      signal: AbortSignal.timeout(25_000),
    });
    if (!upstream.ok) {
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Falha ao obter ${filename} (HTTP ${upstream.status})` }));
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    await fs.mkdir(PS2_CORE_CACHE_DIR, { recursive: true });
    await fs.writeFile(localPath, buf).catch(() => {});

    headers['Content-Length'] = String(buf.byteLength);
    res.writeHead(200, headers);
    res.end(buf);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: `Erro ao baixar núcleo PS2 ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
  }
}

async function handleStreamProxy(req: http.IncomingMessage, res: http.ServerResponse, urlObj: URL): Promise<void> {
  const targetRaw = urlObj.searchParams.get('url');
  if (!targetRaw) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Parâmetro url obrigatório.' }));
    return;
  }

  const target = isAllowedProxyTarget(targetRaw);
  if (!target) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'URL inválida para streaming.' }));
    return;
  }

  const headers: Record<string, string> = {
    'User-Agent': 'VGFA-StreamProxy/0.2 (+https://github.com/Drill23/video-game-for-all)',
    Accept: '*/*',
  };
  if (typeof req.headers.range === 'string') {
    headers.Range = req.headers.range;
  }

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  try {
    const upstream = await fetch(target.toString(), {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });

    if (upstream.status === 401 || upstream.status === 403) {
      await upstream.body?.cancel().catch(() => {});
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error:
            'O servidor de origem bloqueou o acesso (HTTP 401/403 — arquivo privado ou exige login no acervo). Use uma fonte livre ou carregue sua cópia local.',
          status: upstream.status,
        }),
      );
      return;
    }

    const outHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Type',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': 'public, max-age=3600',
    };

    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']) {
      const val = upstream.headers.get(h);
      if (val) outHeaders[h] = val;
    }

    res.writeHead(upstream.status, outHeaders);

    if (req.method === 'HEAD' || !upstream.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
    nodeStream.on('error', () => {
      if (!res.writableEnded) res.end();
    });
    nodeStream.pipe(res);
  } catch (err) {
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: `Falha ao conectar na origem: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
  }
}

async function handleArchiveSearch(res: http.ServerResponse, urlObj: URL): Promise<void> {
  const q = (urlObj.searchParams.get('q') || '').trim();
  const limit = Math.min(24, Math.max(1, Number(urlObj.searchParams.get('limit') || 12)));
  if (!q) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ results: [] }));
    return;
  }

  const sanitized = q.replace(/[()"]/g, ' ');
  // Filtra itens bloqueados/restritos já na consulta do Internet Archive!
  const query = `(${sanitized}) AND mediatype:software AND NOT access-restricted-item:true`;
  const params = new URLSearchParams({
    q: query,
    'fl[]': 'identifier,title,creator,year,collection,downloads',
    'sort[]': 'downloads desc',
    rows: String(limit),
    page: '1',
    output: 'json',
  });

  try {
    const upstream = await fetch(`https://archive.org/advancedsearch.php?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'VGFA/0.2',
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!upstream.ok) {
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Internet Archive retornou HTTP ${upstream.status}` }));
      return;
    }

    const json = (await upstream.json()) as {
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

    const docs = (json.response?.docs ?? []).map((d) => ({
      identifier: d.identifier,
      title: d.title || d.identifier,
      creator: Array.isArray(d.creator) ? d.creator[0] : d.creator,
      year: d.year ? String(d.year) : undefined,
      downloads: d.downloads ?? 0,
      collection: Array.isArray(d.collection) ? d.collection[0] : (d.collection ?? 'software'),
      detailsUrl: `https://archive.org/details/${encodeURIComponent(d.identifier)}`,
      thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ results: docs }));
  } catch (err) {
    res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: `Tempo esgotado ao buscar no Internet Archive: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
  }
}

async function handleArchiveFiles(res: http.ServerResponse, urlObj: URL): Promise<void> {
  const id = (urlObj.searchParams.get('id') || '').trim();
  if (!id) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Parâmetro id obrigatório.' }));
    return;
  }

  try {
    const upstream = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'VGFA/0.2' },
      signal: AbortSignal.timeout(12_000),
    });

    if (!upstream.ok) {
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Falha ao ler metadados (HTTP ${upstream.status})` }));
      return;
    }

    const data = (await upstream.json()) as {
      metadata?: { access_restricted_item?: string };
      files?: Array<{ name: string; size?: string | number; private?: string | boolean }>;
    };

    const itemRestricted = String(data.metadata?.access_restricted_item || '').toLowerCase() === 'true';

    // Nunca retorna arquivos privados/bloqueados nem pacotes de imagens/manuais!
    const files = itemRestricted
      ? []
      : (data.files ?? [])
          .filter((f) => {
            const isPriv = f.private === true || f.private === 'true';
            if (isPriv) return false;
            if (JUNK_FILE_PATTERN.test(f.name)) return false;
            return PLAYABLE_DIRECT_EXT.test(f.name) || ARCHIVE_COMPRESSED_EXT.test(f.name);
          })
          .map((f) => {
            const size = Number(f.size ?? 0);
            const isCompressed = ARCHIVE_COMPRESSED_EXT.test(f.name);
            const isDirect = PLAYABLE_DIRECT_EXT.test(f.name);
            const tooLargeZip = isCompressed && size > 64 * 1024 * 1024;
            const rawUrl = `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(f.name)}`;

            return {
              name: f.name,
              size,
              url: rawUrl,
              proxyUrl: `/api/proxy/stream?url=${encodeURIComponent(rawUrl)}`,
              isPrivate: false,
              isCompressed,
              playableDirectly: isDirect,
              warning: tooLargeZip
                ? 'Arquivo compactado grande (.zip/.7z): baixe, extraia a ROM/ISO e carregue localmente.'
                : undefined,
            };
          })
          .sort((a, b) => Number(b.playableDirectly) - Number(a.playableDirectly) || a.size - b.size);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id, restricted: itemRestricted, files }));
  } catch (err) {
    res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: `Erro ao consultar arquivos do item: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
  }
}

async function handleArchiveSmartFind(res: http.ServerResponse, urlObj: URL): Promise<void> {
  const q = (urlObj.searchParams.get('q') || '').trim();
  const consoleId = (urlObj.searchParams.get('console') || '').trim().toLowerCase();
  const serialParam = (urlObj.searchParams.get('serial') || '').trim().toUpperCase();
  const serialCompact = serialParam.replace(/[^A-Z0-9]/g, '');
  const preferredExt = CONSOLE_EXT_REGEX[consoleId] ?? PLAYABLE_DIRECT_EXT;
  const excludeOtherPlatform = PLATFORM_EXCLUSION_REGEX[consoleId];

  if (!q) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ options: [] }));
    return;
  }

  const sanitized = q.replace(/[()"]/g, ' ');
  const params = new URLSearchParams({
    q: `(${sanitized}) AND mediatype:software AND NOT access-restricted-item:true`,
    'fl[]': 'identifier,title,year,downloads',
    'sort[]': 'downloads desc',
    rows: '8',
    page: '1',
    output: 'json',
  });

  try {
    const searchRes = await fetch(`https://archive.org/advancedsearch.php?${params.toString()}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'VGFA/0.3' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!searchRes.ok) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ options: [], note: 'Acervo público temporariamente indisponível.' }));
      return;
    }

    const searchJson = (await searchRes.json()) as {
      response?: { docs?: Array<{ identifier: string; title?: string; year?: string | number }> };
    };
    const docs = searchJson.response?.docs ?? [];

    const inspected = await Promise.all(
      docs.slice(0, 6).map(async (doc) => {
        try {
          const metaRes = await fetch(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`, {
            headers: { Accept: 'application/json', 'User-Agent': 'VGFA/0.3' },
            signal: AbortSignal.timeout(5_000),
          });
          if (!metaRes.ok) return [];
          const data = (await metaRes.json()) as {
            metadata?: { access_restricted_item?: string };
            files?: Array<{ name: string; size?: string | number; private?: string | boolean }>;
          };
          if (String(data.metadata?.access_restricted_item || '').toLowerCase() === 'true') {
            return [];
          }

          // Extrai palavras-chave relevantes do título buscado para filtrar coleções gigantes
          const queryTokens = sanitized
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length >= 3 && !['the', 'and', 'for', 'ps2', 'ps1', 'psp', 'n64', 'snes', 'nes', 'gba', 'atari', 'usa'].includes(w));

          return (data.files ?? [])
            .filter((f) => {
              const isPriv = f.private === true || f.private === 'true';
              if (isPriv) return false;
              if (JUNK_FILE_PATTERN.test(f.name)) return false;
              // Bloqueia arquivos de OUTROS consoles (ex.: nunca devolver PSP/Chains of Olympus quando pediu PS2!)
              if (excludeOtherPlatform && excludeOtherPlatform.test(f.name)) return false;
              if (consoleId && CONSOLE_EXT_REGEX[consoleId]) {
                if (!preferredExt.test(f.name)) return false;
              } else if (!PLAYABLE_DIRECT_EXT.test(f.name)) {
                return false;
              }
              if ((data.files?.length ?? 0) > 15 && queryTokens.length > 0) {
                const lowerName = f.name.toLowerCase();
                const hit = queryTokens.some((tok) => lowerName.includes(tok));
                if (!hit) return false;
              }
              return true;
            })
            .slice(0, 4)
            .map((f) => {
              const size = Number(f.size ?? 0);
              const lowerName = f.name.toLowerCase();
              const compactName = f.name.toUpperCase().replace(/[^A-Z0-9]/g, '');
              const tokenHits = queryTokens.filter((tok) => lowerName.includes(tok)).length;
              const matchesConsole = preferredExt.test(f.name);
              const matchesSerial = serialCompact.length >= 6 && compactName.includes(serialCompact);
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
                proxyUrl: `/api/proxy/stream?url=${encodeURIComponent(rawUrl)}`,
                playableDirectly: true,
                isCompressed: false,
                score,
              };
            });
        } catch {
          return [];
        }
      }),
    );

    const candidates = inspected
      .flat()
      .sort((a, b) => b.score - a.score || a.size - b.size)
      .slice(0, 6);

    // Verifica de verdade via HEAD se o arquivo realmente está acessível (HTTP 200/206) antes de exibir!
    const verified: Array<(typeof candidates)[number]> = [];
    await Promise.all(
      candidates.map(async (c) => {
        if (await verifyUrlReachable(c.url)) {
          verified.push(c);
        }
      }),
    );

    const finalOptions = verified
      .sort((a, b) => b.score - a.score || a.size - b.size)
      .map((item, idx) => ({
        ...item,
        bestChoice: idx === 0,
      }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        options: finalOptions,
        note:
          finalOptions.length === 0
            ? 'Nenhuma cópia pública aberta disponível para este título no momento. Escolha o arquivo do seu dispositivo abaixo para jogar imediatamente.'
            : undefined,
      }),
    );
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        options: [],
        note: 'Escolha o arquivo do jogo no seu computador/celular para iniciar imediatamente.',
      }),
    );
  }
}

export function createSignalingServer(port = DEFAULT_PORT) {
  const rooms = new Map<string, Room>();
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function generateRoomCode(): string {
    for (let tries = 0; tries < 50; tries++) {
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      }
      const full = `VGFA-${code}`;
      if (!rooms.has(full)) return full;
    }
    return `VGFA-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  }

  function getLanAddresses(): string[] {
    const nets = os.networkInterfaces();
    const ips: string[] = [];
    for (const list of Object.values(nets)) {
      if (!list) continue;
      for (const net of list) {
        if (net.family === 'IPv4' && !net.internal) {
          ips.push(net.address);
        }
      }
    }
    return ips;
  }

  function sendJson(ws: WebSocket, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const urlObj = new URL(req.url || '/', 'http://127.0.0.1');

    if (urlObj.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          service: 'vgfa-signaling',
          activeRooms: rooms.size,
          uptimeSec: Math.round(process.uptime()),
        }),
      );
      return;
    }

    if (urlObj.pathname === '/api/network-info') {
      const lanIps = getLanAddresses();
      const primaryLan = lanIps[0] ?? '127.0.0.1';
      const addr = server.address();
      const activePort = typeof addr === 'object' && addr ? addr.port : port;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          lanIp: primaryLan,
          allLanIps: lanIps,
          webPort: WEB_PORT,
          signalingPort: activePort,
          controllerBaseUrl: `http://${primaryLan}:${WEB_PORT}`,
        }),
      );
      return;
    }

    if (urlObj.pathname.startsWith('/api/ps2-core/')) {
      const file = urlObj.pathname.slice('/api/ps2-core/'.length);
      void handlePs2CoreAsset(res, file);
      return;
    }

    if (urlObj.pathname === '/api/proxy/stream') {
      void handleStreamProxy(req, res, urlObj);
      return;
    }

    if (urlObj.pathname === '/api/archive/search') {
      void handleArchiveSearch(res, urlObj);
      return;
    }

    if (urlObj.pathname === '/api/archive/files') {
      void handleArchiveFiles(res, urlObj);
      return;
    }

    if (urlObj.pathname === '/api/archive/smart-find') {
      void handleArchiveSmartFind(res, urlObj);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let role: 'host' | 'pad' | null = null;
    let roomCode: string | null = null;
    let peerId: string | null = null;

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (role === 'pad' && roomCode) {
          const room = rooms.get(roomCode);
          if (room && room.hostWs.readyState === WebSocket.OPEN) {
            room.hostWs.send(data, { binary: true });
          }
        }
        return;
      }

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      const type = String(msg.type || '');

      if (type === 'host:create') {
        role = 'host';
        roomCode = generateRoomCode();
        const room: Room = {
          code: roomCode,
          hostWs: ws,
          consoleId: String(msg.consoleId || 'ps2'),
          gameTitle: String(msg.gameTitle || 'VGFA'),
          pads: new Map(),
          createdAt: Date.now(),
        };
        rooms.set(roomCode, room);
        sendJson(ws, { type: 'room:created', roomCode });
        return;
      }

      if (type === 'host:console' && role === 'host' && roomCode) {
        const room = rooms.get(roomCode);
        if (!room) return;
        room.consoleId = String(msg.consoleId || room.consoleId);
        room.gameTitle = String(msg.gameTitle || room.gameTitle);
        for (const pad of room.pads.values()) {
          sendJson(pad.ws, {
            type: 'host:console',
            consoleId: room.consoleId,
            gameTitle: room.gameTitle,
          });
        }
        return;
      }

      if (type === 'host:rumble' && role === 'host' && roomCode) {
        const room = rooms.get(roomCode);
        if (!room) return;
        const target = room.pads.get(String(msg.peerId || ''));
        if (target) {
          sendJson(target.ws, {
            type: 'host:rumble',
            slot: target.slot,
            strong: msg.strong,
            weak: msg.weak,
            durationMs: msg.durationMs,
          });
        }
        return;
      }

      if (type === 'pad:join') {
        const requested = String(msg.roomCode || '').trim().toUpperCase();
        const normalized = requested.startsWith('VGFA-') ? requested : `VGFA-${requested}`;
        const room = rooms.get(requested) ?? rooms.get(normalized);
        if (!room) {
          sendJson(ws, { type: 'room:error', message: `Sala ${requested} não encontrada.` });
          return;
        }

        const usedSlots = new Set(Array.from(room.pads.values()).map((p) => p.slot));
        let freeSlot = -1;
        for (let s = 0; s < 4; s++) {
          if (!usedSlots.has(s)) {
            freeSlot = s;
            break;
          }
        }
        if (freeSlot === -1) {
          sendJson(ws, { type: 'room:error', message: 'Sala lotada (máximo 4 jogadores).' });
          return;
        }

        role = 'pad';
        roomCode = room.code;
        peerId = `pad_${Math.random().toString(36).slice(2, 10)}`;
        const label = String(msg.label || `Celular P${freeSlot + 1}`);
        room.pads.set(peerId, { peerId, slot: freeSlot, label, ws });

        sendJson(ws, {
          type: 'room:joined',
          roomCode: room.code,
          peerId,
          slot: freeSlot,
          consoleId: room.consoleId,
          gameTitle: room.gameTitle,
        });

        sendJson(room.hostWs, {
          type: 'pad:joined',
          peerId,
          slot: freeSlot,
          label,
        });
        return;
      }

      if (type === 'rtc:offer' && role === 'host' && roomCode) {
        const room = rooms.get(roomCode);
        const target = room?.pads.get(String(msg.targetPeerId || ''));
        if (target) {
          sendJson(target.ws, { type: 'rtc:offer', sdp: msg.sdp });
        }
        return;
      }

      if (type === 'rtc:answer' && role === 'pad' && roomCode && peerId) {
        const room = rooms.get(roomCode);
        if (room) {
          sendJson(room.hostWs, { type: 'rtc:answer', peerId, sdp: msg.sdp });
        }
        return;
      }

      if (type === 'rtc:ice' && roomCode) {
        const room = rooms.get(roomCode);
        if (!room) return;
        if (role === 'host') {
          const target = room.pads.get(String(msg.targetPeerId || ''));
          if (target) sendJson(target.ws, { type: 'rtc:ice', candidate: msg.candidate });
        } else if (role === 'pad' && peerId) {
          sendJson(room.hostWs, { type: 'rtc:ice', peerId, candidate: msg.candidate });
        }
      }
    });

    ws.on('close', () => {
      if (!roomCode) return;
      const room = rooms.get(roomCode);
      if (!room) return;

      if (role === 'host') {
        for (const pad of room.pads.values()) {
          sendJson(pad.ws, { type: 'room:error', message: 'A tela principal encerrou a sala.' });
          pad.ws.close();
        }
        rooms.delete(roomCode);
      } else if (role === 'pad' && peerId) {
        room.pads.delete(peerId);
        sendJson(room.hostWs, { type: 'pad:left', peerId });
      }
    });
  });

  return {
    server,
    wss,
    start(): Promise<number> {
      return new Promise((resolve) => {
        server.listen(port, '0.0.0.0', () => {
          const addr = server.address();
          const boundPort = typeof addr === 'object' && addr ? addr.port : port;
          const lans = getLanAddresses();
          console.log(`[VGFA Signaling] Rodando em ws://0.0.0.0:${boundPort}`);
          console.log(`[VGFA Signaling] Proxy CORS-Free ativo em /api/proxy/stream`);
          console.log(`[VGFA Signaling] IP LAN detectado para QR Code do celular: ${lans[0] ?? '127.0.0.1'}`);
          resolve(boundPort);
        });
      });
    },
    close(): Promise<void> {
      return new Promise((resolve) => {
        wss.close(() => {
          server.close(() => resolve());
        });
      });
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void createSignalingServer(DEFAULT_PORT).start();
}
