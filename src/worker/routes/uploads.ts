import { Hono } from 'hono';
import { Env } from '../env';
import { AccountView } from '../../shared/contracts';
import { AuthenticatedSession } from '../middleware/session';

export const uploadRoutes = new Hono<{
  Bindings: Env;
  Variables: {
    user?: AccountView;
    session?: AuthenticatedSession;
    requestId: string;
  };
}>();

// CORS preflight handler for direct chunk uploads
uploadRoutes.options('/direct/*', (c) => {
  const origin = c.req.header('origin') || '*';
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Methods', 'PUT, GET, HEAD, OPTIONS');
  c.header(
    'Access-Control-Allow-Headers',
    'Content-Type, Content-Length, Range, Authorization, X-Request-Id, Idempotency-Key'
  );
  c.header('Access-Control-Expose-Headers', 'ETag, Content-Length, Content-Range, X-Request-Id');
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Access-Control-Allow-Private-Network', 'true');
  return c.body(null, 204);
});

// PUT /api/v1/uploads/direct/*
// Local development & testing direct chunk staging to R2
uploadRoutes.put('/direct/*', async (c) => {
  const origin = c.req.header('origin') || '*';
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Expose-Headers', 'ETag, Content-Length, Content-Range, X-Request-Id');
  c.header('Access-Control-Allow-Credentials', 'true');

  const url = new URL(c.req.url);
  const prefix = '/api/v1/uploads/direct/';
  const idx = url.pathname.indexOf(prefix);
  const r2Key = idx !== -1 ? decodeURIComponent(url.pathname.substring(idx + prefix.length)) : '';

  const partNumberStr = c.req.query('partNumber');
  const partNumber = partNumberStr ? parseInt(partNumberStr, 10) : 1;
  const uploadId = c.req.query('uploadId');

  if (!r2Key || !uploadId) {
    return c.text('Missing r2Key or uploadId', 400);
  }

  let etag = `mock-etag-part-${partNumber}`;

  if (c.env.UPLOADS && typeof c.env.UPLOADS.resumeMultipartUpload === 'function') {
    try {
      const upload = c.env.UPLOADS.resumeMultipartUpload(r2Key, uploadId);
      const arrayBuffer = await c.req.arrayBuffer();
      const uploadedPart = await upload.uploadPart(partNumber, arrayBuffer);
      etag = uploadedPart.etag;
    } catch (err) {
      console.warn('Direct uploadPart failed on R2 binding, falling back to mock etag:', err);
    }
  }

  const cleanedEtag = etag.replace(/^W\//, '').replace(/"/g, '').trim();
  c.header('ETag', `"${cleanedEtag}"`);
  return c.text('', 200);
});

uploadRoutes.get('/direct/*', async (c) => {
  const origin = c.req.header('origin') || '*';
  c.header('Access-Control-Allow-Origin', origin);
  return c.text('Direct upload staging endpoint ready', 200);
});
