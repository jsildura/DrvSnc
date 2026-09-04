import { Hono } from 'hono';
import { Env } from '../env';
import { requireSession, AuthenticatedSession } from '../middleware/session';
import { AccountView } from '../../shared/contracts';
import { downloadFile, getFileMetadata } from '../services/driveClient';

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

interface StreamTicketPayload {
  fid: string; // fileId
  uid: string; // userId
  fn: string; // filename
  exp: number; // expiry timestamp ms
}

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function signStreamTicket(secret: string, payload: StreamTicketPayload): Promise<string> {
  const enc = new TextEncoder();
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(enc.encode(payloadStr));

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  const sigB64 = base64UrlEncode(sigBuffer);

  return `${payloadB64}.${sigB64}`;
}

async function verifyStreamTicket(
  secret: string,
  ticket: string
): Promise<StreamTicketPayload | null> {
  const parts = ticket.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = base64UrlDecode(sigB64);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes.buffer as ArrayBuffer,
      enc.encode(payloadB64)
    );
    if (!valid) return null;

    const payloadBytes = base64UrlDecode(payloadB64);
    const payloadStr = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadStr) as StreamTicketPayload;
    if (!payload.fid || !payload.uid || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
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

let cachedDocState: CachedConverterState | null = null;

async function getOrResolveDocState(): Promise<{ sEncoder: string; uidCookie: string }> {
  const now = Date.now();
  if (cachedDocState && now - cachedDocState.fetchedAt < CACHE_TTL_MS) {
    return { sEncoder: cachedDocState.sEncoder, uidCookie: cachedDocState.uidCookie };
  }

  let sEncoder = 's98.convert.io';
  let uidCookie = generateUid();

  try {
    const res = await fetch('https://convert.io/pdf-to-docx', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (res.ok) {
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

  cachedDocState = {
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

// Exempt /stream and /download endpoints from session cookie check since remote encoder uses HMAC signed ticket
// and /download is a safe proxy for converted output from whitelisted encoder clusters
converterRoutes.use('/*', async (c, next) => {
  const path = c.req.path;
  if (path.includes('/converter/stream') || path.includes('/converter/download')) {
    return next();
  }
  return requireSession(c, next);
});

// POST /api/v1/converter/stream-ticket
// Generates an HMAC-signed streaming URL for remote encoder to fetch directly from Google Drive
converterRoutes.post('/stream-ticket', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.text('Unauthorized', 401);
  }

  let body: { fileId?: string; filename?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.text('Invalid JSON', 400);
  }

  const { fileId, filename } = body;
  if (!fileId || typeof fileId !== 'string') {
    return c.text('Missing or invalid fileId', 400);
  }

  const safeFilename = (filename || 'video.mp4').trim().replace(/[/\\?%*:|"<>]/g, '_');
  const exp = Date.now() + 60 * 60 * 1000; // 1 hour ticket

  const ticket = await signStreamTicket(c.env.SESSION_SECRET, {
    fid: fileId,
    uid: user.id,
    fn: safeFilename,
    exp,
  });

  const appOrigin = c.env.APP_ORIGIN || new URL(c.req.url).origin;
  const streamUrl = `${appOrigin}/api/v1/converter/stream/${encodeURIComponent(safeFilename)}?ticket=${ticket}`;

  return c.json({
    ticket,
    streamUrl,
    expiresAt: exp,
  });
});

// Handler for GET and HEAD on /stream and /stream/:filename
const handleStreamRequest = async (c: any) => {
  const ticket = c.req.query('ticket');
  if (!ticket) {
    return c.text('Missing stream ticket', 403);
  }

  const payload = await verifyStreamTicket(c.env.SESSION_SECRET, ticket);
  if (!payload) {
    return c.text('Invalid or expired stream ticket', 403);
  }

  const clientRange = c.req.header('range');
  const isHead = c.req.method.toUpperCase() === 'HEAD';

  try {
    if (isHead) {
      const meta = await getFileMetadata(c.env, payload.uid, payload.fid);
      const headers = new Headers();
      headers.set('Content-Type', meta.mimeType || 'application/octet-stream');
      headers.set('Accept-Ranges', 'bytes');
      if (meta.size) {
        headers.set('Content-Length', String(meta.size));
      }
      headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(payload.fn)}"`);
      return new Response(null, { status: 200, headers });
    }

    const upstreamRes = await downloadFile(c.env, payload.uid, payload.fid, clientRange);
    const headers = new Headers();
    const contentType = upstreamRes.headers.get('Content-Type') || 'application/octet-stream';
    headers.set('Content-Type', contentType);
    headers.set('Accept-Ranges', 'bytes');

    const contentLength = upstreamRes.headers.get('Content-Length');
    if (contentLength) headers.set('Content-Length', contentLength);

    const contentRange = upstreamRes.headers.get('Content-Range');
    if (contentRange) headers.set('Content-Range', contentRange);

    headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(payload.fn)}"`);

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers,
    });
  } catch (err) {
    return c.text(`Stream failed: ${(err as Error).message || 'Google Drive error'}`, 502);
  }
};

converterRoutes.on(['GET', 'HEAD'], '/stream', handleStreamRequest);
converterRoutes.on(['GET', 'HEAD'], '/stream/:filename', handleStreamRequest);

// GET /api/v1/converter/config
converterRoutes.get('/config', async (c) => {
  const mediaType = c.req.query('mediaType');
  const freshUid = generateUid();

  if (mediaType === 'document') {
    const { sEncoder } = await getOrResolveDocState();
    return c.json({
      sEncoder,
      siteId: 'convert',
      uid: freshUid,
      nodes: ['s98.convert.io', 's61.convert.io', 's49.convert.io', 's1.convert.io'],
    });
  }

  const { sEncoder } = await getOrResolveState();
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

  const isConvertIo = sEncoder.includes('convert.io');
  const originUrl = isConvertIo ? 'https://convert.io' : 'https://video-converter.com';

  const upstreamWsUrl = `https://${sEncoder}/socket.io/?EIO=4&transport=websocket`;

  try {
    const upstreamRes = await fetch(upstreamWsUrl, {
      headers: {
        Upgrade: 'websocket',
        Origin: originUrl,
        Referer: `${originUrl}/`,
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

// Helper to format download response with robust attachment header
function handleDownloadResponse(c: any, upstream: Response, parsed: URL): Response {
  const headers = new Headers();
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const contentLength = upstream.headers.get('content-length');
  const rawFilename = c.req.query('filename') || parsed.pathname.split('/').pop() || 'converted_file';
  const asciiFilename = rawFilename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '\\"');
  const encodedFilename = encodeURIComponent(rawFilename);

  headers.set('Content-Type', contentType);
  if (contentLength) headers.set('Content-Length', contentLength);
  headers.set(
    'Content-Disposition',
    `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`
  );

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
}

// GET /api/v1/converter/download
// Proxies download of converted video/audio injecting required Referer and cookies to bypass hotlink protection
converterRoutes.get('/download', async (c) => {
  let fileUrl = c.req.query('url');
  if (!fileUrl) {
    return c.text('Missing file URL', 400);
  }

  try {
    const rawTarget = fileUrl;
    // 123apps returns s*.online-audio-converter.com which lacks DNS records;
    // real encoder servers live under s*.video-converter.com
    fileUrl = fileUrl.replace(/([a-zA-Z0-9_-]+)\.online-audio-converter\.com/g, '$1.video-converter.com');
    const parsed = new URL(fileUrl);
    const ALLOWED_CONVERTER_DOMAINS = [
      'video-converter.com',
      'online-audio-converter.com',
      '123apps.com',
      '123apps.org',
      'audio-converter.com',
      'convert.io',
      '123apps.io',
    ];
    const isAllowed = ALLOWED_CONVERTER_DOMAINS.some(
      (d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`)
    );
    if (!isAllowed) {
      return c.text('Forbidden host', 403);
    }

    const { uidCookie: defaultUid } = await getOrResolveState();
    const uid = c.req.query('uid') || defaultUid;

    const isDoc =
      parsed.pathname.includes('/convert/') ||
      parsed.hostname.includes('convert.io') ||
      c.req.query('mediaType') === 'document';

    const isAudio =
      parsed.pathname.includes('/aconv/') ||
      rawTarget.includes('online-audio') ||
      c.req.query('mediaType') === 'audio';

    const originUrl = isDoc
      ? 'https://convert.io'
      : isAudio
      ? 'https://online-audio-converter.com'
      : 'https://video-converter.com';

    const upstream = await fetch(fileUrl, {
      headers: {
        ...COMMON_CHROME_HEADERS,
        Origin: originUrl,
        Referer: `${originUrl}/`,
        Cookie: `uid=${uid}`,
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
      },
    });

    if (!upstream.ok) {
      // Fallback: try alternate 123apps origin in case upstream node expects video-converter vs audio-converter
      const fallbackOrigin = isAudio
        ? 'https://video-converter.com'
        : 'https://online-audio-converter.com';
      const fallbackRes = await fetch(fileUrl, {
        headers: {
          ...COMMON_CHROME_HEADERS,
          Origin: fallbackOrigin,
          Referer: `${fallbackOrigin}/`,
          Cookie: `uid=${uid}`,
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
        },
      });

      if (fallbackRes.ok) {
        return handleDownloadResponse(c, fallbackRes, parsed);
      }

      return c.text(`Download failed from upstream converter (status ${upstream.status})`, upstream.status as any);
    }

    return handleDownloadResponse(c, upstream, parsed);
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
  const requestedSiteId = c.req.query('site_id') || 'vconv';
  const sEncoder = requestedEncoder || defaultEncoder;
  const uid = requestedUid || defaultUid;

  const targetUrl = `https://${sEncoder}/${requestedSiteId}/upload/flow/${query ? `?${query}` : ''}`;

  const contentType = c.req.header('content-type') || '';
  const contentLength = c.req.header('content-length');

  const originUrl =
    requestedSiteId === 'convert'
      ? 'https://convert.io'
      : requestedSiteId === 'aconv'
      ? 'https://online-audio-converter.com'
      : 'https://video-converter.com';
  const forwardHeaders: Record<string, string> = {
    ...COMMON_CHROME_HEADERS,
    Origin: originUrl,
    Referer: `${originUrl}/`,
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

// POST /api/v1/converter/process
// Proxies document conversion process call to convert.io with valid origin and cookies
converterRoutes.post('/process', async (c) => {
  let body: {
    encoder?: string;
    siteId?: string;
    uid?: string;
    operationId?: string;
    convertFrom?: string;
    convertTo?: string;
    tmpFilename?: string;
    settings?: Record<string, any>;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.text('Invalid JSON', 400);
  }

  const {
    encoder = 's98.convert.io',
    siteId = 'convert',
    uid = generateUid(),
    operationId = `${Date.now()}_${encoder.replace(/[^a-zA-Z0-9]/g, '')}_${Math.random().toString(36).substring(2, 8)}`,
    convertFrom,
    convertTo,
    tmpFilename,
  } = body;

  if (!tmpFilename || !convertFrom || !convertTo) {
    return c.json(
      { error: 1, error_title: 'Missing required parameters (tmpFilename, convertFrom, convertTo)' },
      400
    );
  }

  const targetUrl = `https://${encoder}/${siteId}/process/`;
  const postParams = new URLSearchParams({
    site_id: siteId,
    codebase_id: siteId,
    uid,
    operation_id: operationId,
    action_type: 'process',
    convert_from: convertFrom,
    convert_to: convertTo,
    tmp_filename: tmpFilename,
  });

  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://convert.io',
        Referer: 'https://convert.io/',
        Cookie: `uid=${uid}`,
        'User-Agent': COMMON_CHROME_HEADERS['User-Agent'],
      },
      body: postParams.toString(),
    });

    const responseText = await upstream.text();
    let jsonResult: any;
    try {
      jsonResult = JSON.parse(responseText);
    } catch {
      return c.json({ error: 1, error_title: responseText || 'Invalid upstream response' }, 502);
    }

    return c.json(jsonResult);
  } catch (err) {
    return c.json(
      { error: 1, error_title: (err as Error).message || 'Failed to proxy conversion request' },
      502
    );
  }
});
