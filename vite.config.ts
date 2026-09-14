import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import https from 'https';
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Vite dev server plugin that proxies unarchiver Flow.js uploads directly to
 * extract.me encoder nodes via Node.js `https`, bypassing the Cloudflare Worker
 * relay (`/api/v1/converter/flow`).
 *
 * Why: workerd (miniflare) on local dev cannot reliably make outbound HTTPS
 * connections to extract.me cluster nodes — the socket hangs for 20+ seconds
 * and then crashes the isolate with an opaque "internal error; reference = …".
 * Node.js has no such limitation, so Vite's own process handles the proxy.
 *
 * In production this path is unused; the real Cloudflare Worker relay works fine.
 */
function extractMeDirectProxy(): Plugin {
  return {
    name: 'extract-me-direct-proxy',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.includes('/api/v1/converter/flow')) {
          return next();
        }

        const parsed = new URL(req.url, 'http://localhost');
        if (parsed.searchParams.get('site_id') !== 'unarchiver') {
          return next(); // non-unarchiver flow → forward to workerd as normal
        }

        const encoder = parsed.searchParams.get('encoder') || 's88.extract.me';
        const uid = parsed.searchParams.get('uid') || '';
        const ud = parsed.searchParams.get('ud') || '1';

        // Collect the incoming multipart body
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = Buffer.concat(chunks);

          const targetPath = `/unarchiver/upload/flow/?uid=${encodeURIComponent(uid)}&ud=${ud}`;
          const options: https.RequestOptions = {
            hostname: encoder,
            port: 443,
            path: targetPath,
            method: 'POST',
            headers: {
              'Content-Type': req.headers['content-type'] || 'multipart/form-data',
              'Content-Length': String(body.length),
              Origin: 'https://extract.me',
              Referer: 'https://extract.me/',
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Cookie: `uid=${uid}`,
            },
            timeout: 60000,
          };

          const proxyReq = https.request(options, (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 502, {
              'Content-Type': proxyRes.headers['content-type'] || 'application/json',
            });
            proxyRes.pipe(res);
          });

          proxyReq.on('timeout', () => {
            proxyReq.destroy();
            if (!res.headersSent) {
              res.writeHead(504, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { code: 'GATEWAY_TIMEOUT', message: `Upstream ${encoder} timed out after 60s`, retriable: true } }));
            }
          });

          proxyReq.on('error', (err) => {
            console.error(`[extract-me-proxy] Error connecting to ${encoder}: ${err.message}`);
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { code: 'PROXY_ERROR', message: err.message, retriable: true } }));
            }
          });

          proxyReq.write(body);
          proxyReq.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), extractMeDirectProxy()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Target 127.0.0.1, not localhost: wrangler dev binds workerd to IPv4 only
      // (--socket-addr=entry=127.0.0.1:8787), while Node resolves "localhost" to
      // ::1 first. Going through "localhost" leaves every /api call depending on
      // an IPv6 -> IPv4 fallback that adds latency and intermittently 502s.
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
