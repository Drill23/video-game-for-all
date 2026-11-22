/* VGFA Nexus Service Worker v0.6
 * 1) Injeta COOP: same-origin + COEP: require-corp + CORP: cross-origin em hospedagem estática (GitHub Pages)
 *    destravando SharedArrayBuffer, WASM pthreads e WebGPU 60 FPS sem precisar de servidor backend!
 * 2) Cache persistente local (vgfa-nexus-cores-v1) para núcleos WASM leves (Play.wasm, PCSX2 WASM, disc-worker),
 *    reduzindo o tempo de boot de segundos para milissegundos após ativar o Otimizador VGFA!
 */

const CORE_CACHE = 'vgfa-nexus-cores-v1';
const CORE_ASSET_REGEX = /\/(ps2-core|ps2-turbo|api\/ps2-core|api\/ps2-turbo)\/[^/?#]+\.(js|wasm|data)$/i;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function withIsolationHeaders(response) {
  if (!response || response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (!headers.has('Cross-Origin-Resource-Policy')) {
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'vgfa-prewarm-cores') return;

  const urls = Array.isArray(data.urls) ? data.urls : [];
  const port = event.ports && event.ports[0];

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CORE_CACHE);
      let done = 0;
      let totalBytes = 0;
      const results = [];

      for (const rawUrl of urls) {
        try {
          const existing = await cache.match(rawUrl);
          if (existing) {
            const len = Number(existing.headers.get('content-length') || 0);
            totalBytes += len;
            done++;
            results.push({ url: rawUrl, status: 'cached', bytes: len });
            if (port) port.postMessage({ type: 'progress', done, total: urls.length, url: rawUrl, cached: true });
            continue;
          }
          const resp = await fetch(rawUrl, { credentials: 'same-origin' });
          if (resp.ok) {
            const clone = withIsolationHeaders(resp.clone());
            const buf = await resp.arrayBuffer();
            totalBytes += buf.byteLength;
            await cache.put(
              rawUrl,
              new Response(buf, {
                status: 200,
                headers: {
                  'Content-Type': clone.headers.get('Content-Type') || 'application/octet-stream',
                  'Content-Length': String(buf.byteLength),
                  'Cross-Origin-Opener-Policy': 'same-origin',
                  'Cross-Origin-Embedder-Policy': 'require-corp',
                  'Cross-Origin-Resource-Policy': 'cross-origin',
                },
              }),
            );
            done++;
            results.push({ url: rawUrl, status: 'downloaded', bytes: buf.byteLength });
            if (port) port.postMessage({ type: 'progress', done, total: urls.length, url: rawUrl, bytes: buf.byteLength });
          } else {
            results.push({ url: rawUrl, status: 'skip-' + resp.status, bytes: 0 });
          }
        } catch (err) {
          results.push({ url: rawUrl, status: 'err', bytes: 0 });
        }
      }

      if (port) port.postMessage({ type: 'done', done, total: urls.length, totalBytes, results });
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Não intercepta proxies de streaming pesado ou WebSocket
  if (url.pathname.startsWith('/api/proxy/') || url.pathname.startsWith('/ws')) return;

  event.respondWith(
    (async () => {
      // Cache-first ultrarrápido (< 5 ms) para núcleos WASM já pré-aquecidos!
      if (CORE_ASSET_REGEX.test(url.pathname)) {
        const cache = await caches.open(CORE_CACHE);
        const hit = await cache.match(req);
        if (hit) return withIsolationHeaders(hit);

        const net = await fetch(req);
        if (net.ok) {
          const wrapped = withIsolationHeaders(net.clone());
          cache.put(req, wrapped).catch(() => {});
          return withIsolationHeaders(net);
        }
        return net;
      }

      const net = await fetch(req);
      return withIsolationHeaders(net);
    })().catch((err) => {
      return new Response('VGFA SW fetch error: ' + String(err), { status: 502 });
    }),
  );
});
