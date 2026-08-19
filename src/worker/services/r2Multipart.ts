import { AwsClient } from 'aws4fetch';
import { Env } from '../env';

export const DEFAULT_PART_SIZE = 16 * 1024 * 1024; // 16 MiB
export const MIN_PART_SIZE = 5 * 1024 * 1024; // 5 MiB
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
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `staging/${userId}/${jobId}/${sanitizedFilename}`;
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
  if (env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ACCOUNT_ID) {
    const aws = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      service: 's3',
      region: 'auto',
    });

    const bucket = env.R2_BUCKET_NAME || 'gdu-uploads-local';
    const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/${r2Key}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;

    const signed = await aws.sign(endpoint, {
      method: 'PUT',
      aws: { signQuery: true },
    });

    return signed.url;
  }

  // Local development / testing signed URL fallback
  const origin = env.APP_ORIGIN || 'http://localhost:8787';
  return `${origin}/api/v1/uploads/direct/${r2Key}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;
}

export async function completeMultipartUpload(
  env: Env,
  r2Key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[]
): Promise<{ key: string; size: number } | null> {
  if (env.UPLOADS && typeof env.UPLOADS.resumeMultipartUpload === 'function') {
    try {
      const upload = env.UPLOADS.resumeMultipartUpload(r2Key, uploadId);
      const r2Object = await upload.complete(
        parts.map((p) => ({
          partNumber: p.partNumber,
          etag: p.etag,
        }))
      );
      return { key: r2Object.key, size: r2Object.size };
    } catch (_err) {
      // In Miniflare or mocked isolate environments the multipart parts were
      // never really staged. Report "unconfirmed" rather than inventing a size.
      return null;
    }
  }

  return { key: r2Key, size: parts.length * DEFAULT_PART_SIZE };
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
