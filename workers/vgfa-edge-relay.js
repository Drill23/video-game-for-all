/**
 * VGFA Edge Relay (Cloudflare Worker — Plano Grátis: 100.000 reqs/dia!)
 * Repassa HTTP 206 Byte Ranges com CORS + CORP + 3x retry anti-503 para streaming
 * instantâneo de ISOs de 4 GB direto no GitHub Pages (sem precisar do Mac ligado!).
 */
export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type',
          'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Type',
        },
      });
    }

    const reqUrl = new URL(request.url);
    const targetRaw = reqUrl.searchParams.get('url');
    if (!targetRaw || !/^https?:\/\//i.test(targetRaw)) {
      return new Response(JSON.stringify({ ok: true, service: 'vgfa-edge-relay' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const headers = new Headers({ 'User-Agent': 'VGFA-EdgeRelay/0.6' });
    const range = request.headers.get('Range');
    if (range) headers.set('Range', range);

    let upstream = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      upstream = await fetch(targetRaw, { method: request.method, headers, redirect: 'follow' });
      if (upstream.status !== 503 && upstream.status !== 429 && upstream.status !== 502) break;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }

    const outHeaders = new Headers();
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']) {
      const v = upstream.headers.get(h);
      if (v) outHeaders.set(h, v);
    }
    outHeaders.set('Access-Control-Allow-Origin', '*');
    outHeaders.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Type');
    outHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
    outHeaders.set('Cache-Control', 'public, max-age=3600');

    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: outHeaders,
    });
  },
};
