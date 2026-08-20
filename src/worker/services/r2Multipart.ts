import { AwsClient } from 'aws4fetch';
import { Env } from '../env';

export const DEFAULT_PART_SIZE = 16 * 1024 * 1024; // 16 MiB
export const MAX_PARTS = 10000;

export function calculatePartLayout(fileSize: number): { partSize: number; partCount: number } {
  let partSize = DEFAULT_PART_SIZE;
  let partCount = Math.ceil(fileSize / partSize);

  if (partCount > MAX_PARTS) {
    partSize = Math.ceil(fileSize / MAX_PARTS);
    partCount = Math.ceil(fileSize / partSize);
  }

  return { partSize, partCount: Math.max(partCount, 1) };
}

export function generateR2Key(userId: string, jobId: string, filename: string): string {
  return [
    'staging',
    safeKeySegment(userId, 'user'),
    safeKeySegment(jobId, 'job'),
    safeKeySegment(filename, 'file'),
  ].join('/');
}

/**
 * Key to use for a staging row that has no `r2_object_key` stored.
 *
 * Only mock and pre-migration rows take this path, but it is still built from request-derived values,
 * so it goes through the same sanitizing as a freshly generated key.
 */
export function stagingFallbackKey(userId: string, jobId: string): string {
  return ['staging', safeKeySegment(userId, 'user'), safeKeySegment(jobId, 'job')].join('/');
}

/**
 * Reduce one value to a single safe path segment.
 *
 * Every segment of this key is interpolated into the presigned S3 endpoint below, so a `/` or a `..`
 * would relocate the object — including into another user's `staging/` prefix — and a `?` or `#`
 * would rewrite the query the signature covers. `jobId` is the caller-supplied `Idempotency-Key`,
 * which the routes validate, but a key that reaches R2 is not the place to rely on that alone.
 */
function safeKeySegment(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    // Stated outright rather than inferred from `/` having just been stripped: no run of dots
    // survives, so no segment can ever be read as a parent-directory reference.
    .replace(/\.{2,}/g, '_')
    .replace(/^\./, '_');
  return cleaned || fallback;
}

export async function initiateMultipartUpload(
  env: Env,
  r2Key: string,
  mimeType: string
): Promise<{ uploadId: string }> {
  if (env.UPLOADS && typeof env.UPLOADS.createMultipartUpload === 'function') {
    const upload = await env.UPLOADS.createMultipartUpload(r2Key, {
      httpMetadata: { contentType: mimeType },
    });
    return { uploadId: upload.uploadId };
  }

  // Fallback for mock environments
  return { uploadId: `mock-upload-${Date.now()}` };
}

export async function signPartUploadUrl(
  env: Env,
  r2Key: string,
  uploadId: string,
  partNumber: number
): Promise<string> {
  // The signature covers the canonical URI, so each segment goes in percent-encoded. Without this a
  // key carrying a `?`, `#` or `..` would sign one request and address another.
  const encodedKey = r2Key.split('/').map(encodeURIComponent).join('/');

  if (env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ACCOUNT_ID) {
    const aws = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      service: 's3',
      region: 'auto',
    });

    const bucket = env.R2_BUCKET_NAME || 'gdu-uploads-local';
    const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeURIComponent(bucket)}/${encodedKey}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;

    const signed = await aws.sign(endpoint, {
      method: 'PUT',
      aws: { signQuery: true },
    });

    return signed.url;
  }

  // Local development / testing signed URL fallback
  const origin = env.APP_ORIGIN || 'http://localhost:8787';
  return `${origin}/api/v1/uploads/direct/${encodedKey}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;
}

/**
 * Assemble the staged parts into one object.
 *
 * `confirmed` distinguishes a size R2 reported from one that was inferred. Only the real
 * `complete()` path knows the assembled length; anything else is a guess, and a guessed total would
 * corrupt the `Content-Range` header of the Drive resumable session that consumes this object.
 */
export async function completeMultipartUpload(
  env: Env,
  r2Key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[]
): Promise<{ key: string; size: number; confirmed: boolean } | null> {
  if (env.UPLOADS && typeof env.UPLOADS.resumeMultipartUpload === 'function') {
    try {
      const upload = env.UPLOADS.resumeMultipartUpload(r2Key, uploadId);
      const r2Object = await upload.complete(
        parts.map((p) => ({
          partNumber: p.partNumber,
          etag: p.etag,
        }))
      );
      return { key: r2Object.key, size: r2Object.size, confirmed: true };
    } catch (_err) {
      // In Miniflare or mocked isolate environments the multipart parts were
      // never really staged. Report "unconfirmed" rather than inventing a size.
      return null;
    }
  }

  return { key: r2Key, size: parts.length * DEFAULT_PART_SIZE, confirmed: false };
}

export async function abortMultipartUpload(
  env: Env,
  r2Key: string,
  uploadId: string
): Promise<void> {
  if (env.UPLOADS && typeof env.UPLOADS.resumeMultipartUpload === 'function') {
    try {
      const upload = env.UPLOADS.resumeMultipartUpload(r2Key, uploadId);
      await upload.abort();
    } catch (_err) {
      // Ignore abort errors
    }
  }
}

export async function deleteR2Object(env: Env, r2Key: string): Promise<void> {
  if (env.UPLOADS && typeof env.UPLOADS.delete === 'function') {
    await env.UPLOADS.delete(r2Key);
  }
}
