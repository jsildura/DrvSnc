import { Hono } from 'hono';
import { Env } from '../env';
import { requireSession, AuthenticatedSession } from '../middleware/session';
import { AccountView } from '../../shared/contracts';

interface CachedConverterState {
  sEncoder: string;
  uidCookie: string;
  fetchedAt: number;
}

let cachedState: CachedConverterState | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function generateUid(): string {
  // Generates 32-char alphanumeric uid matching 123Apps format (e.g. arjlS97NPL4bebNSAzV6a99392a7d6eb)
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let uid = 'a';
  for (let i = 0; i < 31; i++) {
    uid += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return uid;
}

async function getOrResolveState(): Promise<{ sEncoder: string; uidCookie: string }> {
  const now = Date.now();
  if (cachedState && now - cachedState.fetchedAt < CACHE_TTL_MS) {
    return { sEncoder: cachedState.sEncoder, uidCookie: cachedState.uidCookie };
  }

  let sEncoder = 's97.video-converter.com';
  let uidCookie = generateUid();

  try {
    const res = await fetch('https://video-converter.com', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (res.ok) {
      // Capture legitimate uid cookie if returned
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        const uidMatch = setCookie.match(/uid=([a-zA-Z0-9_-]+)/);
        if (uidMatch && uidMatch[1]) {
          uidCookie = uidMatch[1];
        }
      }

      const html = await res.text();
      const match = html.match(/"s_encoder":\s*"([^"]+)"/);
      if (match && match[1]) {
        sEncoder = match[1];
      }
    }
  } catch {
    // Keep defaults
  }

  cachedState = {
    sEncoder,
    uidCookie,
    fetchedAt: now,
  };

  return { sEncoder, uidCookie };
}

const COMMON_CHROME_HEADERS: Record<string, string> = {
  Origin: 'https://video-converter.com',
  Referer: 'https://video-converter.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
};

const KNOWN_ENCODER_NODES = [
  's95.video-converter.com',
  's96.video-converter.com',
  's97.video-converter.com',
  's98.video-converter.com',
  's99.video-converter.com',
];

export const converterRoutes = new Hono<{
  Bindings: Env;
  Variables: {
    user?: AccountView;
    session?: AuthenticatedSession;
    requestId: string;
  };
}>();

converterRoutes.use('/*', requireSession);

// GET /api/v1/converter/config
converterRoutes.get('/config', async (c) => {
  const { sEncoder } = await getOrResolveState();
  // Fresh UID token for this conversion session to reset the daily conversion counter
  const freshUid = generateUid();
  return c.json({
    sEncoder,
    siteId: 'vconv',
    uid: freshUid,
    nodes: KNOWN_ENCODER_NODES,
  });
});

// GET /api/v1/converter/ws
// Proxies real-time Socket.IO WebSocket through the worker so 123Apps only sees
// Origin: https://video-converter.com and the exact same IP as the chunk uploads.
converterRoutes.get('/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade') || c.req.header('upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426);
  }

  if (typeof WebSocketPair === 'undefined') {
    return c.text('WebSocket proxy not supported in this runtime', 501);
  }

  const { sEncoder: defaultEncoder, uidCookie: defaultUid } = await getOrResolveState();
  const requestedEncoder = c.req.query('encoder');
  const requestedUid = c.req.query('uid');
  const sEncoder = requestedEncoder || defaultEncoder;
  const uid = requestedUid || defaultUid;

  const upstreamWsUrl = `https://${sEncoder}/socket.io/?EIO=4&transport=websocket`;

  try {
    const upstreamRes = await fetch(upstreamWsUrl, {
      headers: {
        Upgrade: 'websocket',
        Origin: 'https://video-converter.com',
        Referer: 'https://video-converter.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Cookie: `uid=${uid}`,
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': c.req.header('sec-websocket-key') || 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });

    const upstreamSocket = upstreamRes.webSocket;
    if (!upstreamSocket) {
      return c.text('Upstream did not return a websocket', 502);
    }
    upstreamSocket.accept();

    const pair = new WebSocketPair();
    const [clientSocket, serverSocket] = Object.values(pair);
    serverSocket.accept();

    serverSocket.addEventListener('message', (event) => {
      try {
        upstreamSocket.send(event.data);
      } catch {
        // ignore send error
      }
    });

    serverSocket.addEventListener('close', (event) => {
      try {
        upstreamSocket.close(event.code, event.reason);
      } catch {
        // ignore
      }
    });

    serverSocket.addEventListener('error', () => {
      try {
        upstreamSocket.close();
      } catch {
        // ignore
      }
    });

    upstreamSocket.addEventListener('message', (event) => {
      try {
        serverSocket.send(event.data);
      } catch {
        // ignore send error
      }
    });

    upstreamSocket.addEventListener('close', (event) => {
      try {
        serverSocket.close(event.code, event.reason);
      } catch {
        // ignore
      }
    });

    upstreamSocket.addEventListener('error', () => {
      try {
        serverSocket.close();
      } catch {
        // ignore
      }
    });

    return new Response(null, {
      status: 101,
      webSocket: clientSocket,
    });
  } catch {
    return c.text('Failed to connect upstream websocket proxy', 502);
  }
});

// GET /api/v1/converter/download
// Proxies download of converted video injecting required Referer and cookies to bypass hotlink protection
converterRoutes.get('/download', async (c) => {
  const fileUrl = c.req.query('url');
  if (!fileUrl) {
    return c.text('Missing file URL', 400);
  }

  try {
    const parsed = new URL(fileUrl);
    if (!parsed.hostname.endsWith('.video-converter.com') && parsed.hostname !== 'video-converter.com') {
      return c.text('Forbidden host', 403);
    }

    const { uidCookie: defaultUid } = await getOrResolveState();
    const uid = c.req.query('uid') || defaultUid;

    const upstream = await fetch(fileUrl, {
      headers: {
        ...COMMON_CHROME_HEADERS,
        Cookie: `uid=${uid}`,
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
      },
    });

    const headers = new Headers();
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const contentLength = upstream.headers.get('content-length');
    const contentDisposition = upstream.headers.get('content-disposition');
    headers.set('Content-Type', contentType);
    if (contentLength) headers.set('Content-Length', contentLength);
    if (contentDisposition) headers.set('Content-Disposition', contentDisposition);

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch {
    return c.text('Failed to download file', 502);
  }
});

// POST /api/v1/converter/flow
// Relays Flow.js chunk upload with Chrome browser fingerprint and legitimate uid cookie
converterRoutes.post('/flow', async (c) => {
  const query = c.req.url.includes('?') ? c.req.url.split('?')[1] : '';
  const { sEncoder: defaultEncoder, uidCookie: defaultUid } = await getOrResolveState();
  const requestedEncoder = c.req.query('encoder');
  const requestedUid = c.req.query('uid');
  const sEncoder = requestedEncoder || defaultEncoder;
  const uid = requestedUid || defaultUid;

  const targetUrl = `https://${sEncoder}/vconv/upload/flow/${query ? `?${query}` : ''}`;

  const contentType = c.req.header('content-type') || '';
  const contentLength = c.req.header('content-length');

  const forwardHeaders: Record<string, string> = {
    ...COMMON_CHROME_HEADERS,
    Cookie: `uid=${uid}`,
  };

  if (contentType) {
    forwardHeaders['Content-Type'] = contentType;
  }
  if (contentLength) {
    forwardHeaders['Content-Length'] = contentLength;
  }

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: 'POST',
      headers: forwardHeaders,
      body: c.req.raw.body,
      // @ts-expect-error duplex required for streaming request bodies in some environments
      duplex: 'half',
    });

    const responseText = await upstreamRes.text();

    return new Response(responseText, {
      status: upstreamRes.status,
      headers: {
        'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
      },
    });
  } catch (err) {
    return c.json(
      {
        error: {
          code: 'CONVERTER_UPLOAD_FAILED',
          message: (err as Error).message || 'Failed to relay chunk to video converter engine',
          retriable: true,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      502
    );
  }
});
