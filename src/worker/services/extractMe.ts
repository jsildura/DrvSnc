import { Env } from '../env';
import { startResumableUpload, uploadChunk } from './driveClient';

export const EXTRACT_ME_SITE_ID = 'unarchiver';
export const DEFAULT_EXTRACT_ME_HOST = 's88.extract.me';

export const KNOWN_EXTRACT_ME_HOSTS = [
  's88.extract.me',
  's85.extract.me',
];


function generateUid(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let res = '';
  for (let i = 0; i < 16; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

/**
 * Resolves the active extract.me encoder host and uid.
 * Uses the proven default encoder cluster (s84.extract.me) directly without
 * performing outbound network probes that can trigger isolate aborts.
 */
export async function getOrResolveExtractMeHost(): Promise<{ sEncoder: string; uidCookie: string }> {
  return {
    sEncoder: DEFAULT_EXTRACT_ME_HOST,
    uidCookie: generateUid(),
  };
}

export function getExtractMeApiUrl(host: string): string {
  return `https://${host}/${EXTRACT_ME_SITE_ID}`;
}

export function getExtractMeDownloadUrl(
  host: string,
  uid: string,
  tmpFilename: string,
  path: string
): string {
  return `https://${host}/${EXTRACT_ME_SITE_ID}/download_d/${uid || 'nouid'}/${tmpFilename}/${encodeURIComponent(path)}`;
}

export function getExtractMeZipUrl(
  host: string,
  uid: string,
  tmpFilename: string
): string {
  return `https://${host}/${EXTRACT_ME_SITE_ID}/compress/zip/${uid ? `${uid}/` : 'nouid/'}${tmpFilename}`;
}

/**
 * Downloads a file/zip from extract.me and streams it directly to Google Drive
 * using a resumable upload session.
 */
export async function uploadExtractedStreamToDrive(
  env: Env,
  userId: string,
  options: {
    downloadUrl: string;
    fileName: string;
    destinationFolderId?: string;
  }
): Promise<{ fileId: string; fileName: string; folderId?: string }> {
  const { downloadUrl, fileName, destinationFolderId } = options;

  // Validate allowed domains for security
  const parsed = new URL(downloadUrl);
  const isAllowed =
    parsed.hostname === 'extract.me' ||
    parsed.hostname.endsWith('.extract.me') ||
    parsed.hostname === 'extract.io' ||
    parsed.hostname.endsWith('.extract.io') ||
    parsed.hostname === '123apps.com' ||
    parsed.hostname.endsWith('.123apps.com');

  if (!isAllowed) {
    throw new Error('Invalid or unapproved download host');
  }

  // Fetch the file from extract.me
  const upstreamRes = await fetch(downloadUrl, {
    headers: {
      Origin: 'https://extract.me',
      Referer: 'https://extract.me/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!upstreamRes.ok) {
    throw new Error(`Failed to fetch extracted file from engine: ${upstreamRes.status} ${upstreamRes.statusText}`);
  }

  const contentType = upstreamRes.headers.get('content-type') || 'application/octet-stream';
  const contentLengthHeader = upstreamRes.headers.get('content-length');
  const totalSize = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;

  // Initialize resumable upload on Google Drive
  const sessionUrl = await startResumableUpload(env, userId, {
    name: fileName,
    mimeType: contentType,
    folderId: destinationFolderId,
  });

  // Read the upstream body
  if (upstreamRes.body) {
    const reader = upstreamRes.body.getReader();
    let receivedBytes = 0;

    // Buffer in 5MB chunks (Google Drive recommends multiples of 256 KiB)
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
    let currentBuffer = new Uint8Array(CHUNK_SIZE);
    let currentOffset = 0;
    let uploadedOffset = 0;
    let finalGoogleFile: { id: string } | null = null;

    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        receivedBytes += value.length;
        let valueOffset = 0;

        while (valueOffset < value.length) {
          const space = currentBuffer.length - currentOffset;
          const toCopy = Math.min(space, value.length - valueOffset);
          currentBuffer.set(value.subarray(valueOffset, valueOffset + toCopy), currentOffset);
          currentOffset += toCopy;
          valueOffset += toCopy;

          if (currentOffset === currentBuffer.length) {
            // Buffer is full, upload chunk
            const res = await uploadChunk(
              sessionUrl,
              currentBuffer.buffer as ArrayBuffer,
              uploadedOffset,
              totalSize ?? '*'
            );
            if (res.status === 200 || res.status === 201) {
              finalGoogleFile = (await res.json()) as { id: string };
            } else if (res.status !== 308) {
              throw new Error(`Google upload chunk failed with status ${res.status}`);
            }
            uploadedOffset += currentBuffer.length;
            currentOffset = 0;
            currentBuffer = new Uint8Array(CHUNK_SIZE);
          }
        }
      }

      if (done) {
        break;
      }
    }

    // Final chunk handling
    const finalChunkLength = currentOffset;
    const finalTotal = totalSize ?? receivedBytes;

    if (!finalGoogleFile) {
      if (finalTotal === 0) {
        // Empty file: complete with bytes */0
        const emptyRes = await fetch(sessionUrl, {
          method: 'PUT',
          headers: {
            'Content-Range': 'bytes */0',
            'Content-Length': '0',
          },
        });
        if (emptyRes.status === 200 || emptyRes.status === 201) {
          finalGoogleFile = (await emptyRes.json()) as { id: string };
        } else {
          throw new Error(`Google upload empty file failed with status ${emptyRes.status}`);
        }
      } else if (finalChunkLength > 0) {
        const finalBuffer = currentBuffer.subarray(0, finalChunkLength);
        const res = await uploadChunk(
          sessionUrl,
          finalBuffer.buffer.slice(0, finalChunkLength) as ArrayBuffer,
          uploadedOffset,
          finalTotal
        );

        if (res.status === 200 || res.status === 201) {
          finalGoogleFile = (await res.json()) as { id: string };
        } else {
          throw new Error(`Google upload final chunk failed with status ${res.status}`);
        }
      } else {
        // Exactly landed on chunk boundary without commit
        const commitRes = await fetch(sessionUrl, {
          method: 'PUT',
          headers: {
            'Content-Range': `bytes */${finalTotal}`,
          },
        });
        if (commitRes.status === 200 || commitRes.status === 201) {
          finalGoogleFile = (await commitRes.json()) as { id: string };
        } else {
          throw new Error(`Google upload commit failed with status ${commitRes.status}`);
        }
      }
    }

    return {
      fileId: finalGoogleFile?.id || 'unknown',
      fileName,
      folderId: destinationFolderId,
    };
  }

  throw new Error('Upstream response body is empty');
}
