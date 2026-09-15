import { Env } from '../env';
import { startResumableUpload, uploadChunk, createEmptyDriveFile } from './driveClient';

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
    fileSize?: number;
  }
): Promise<{ fileId: string; fileName: string; folderId?: string }> {
  const { downloadUrl, fileName, destinationFolderId, fileSize } = options;

  // If known upfront that file is zero bytes, create directly without upstream network calls
  if (fileSize === 0) {
    const emptyFile = await createEmptyDriveFile(env, userId, {
      name: fileName,
      mimeType: 'application/octet-stream',
      folderId: destinationFolderId,
    });
    return {
      fileId: emptyFile.id,
      fileName,
      folderId: destinationFolderId,
    };
  }

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

  // Extract uid from URL if present to forward as Cookie
  const uidMatch = downloadUrl.match(/\/unarchiver\/download_[dt]\/([^/]+)\//);
  const uid = uidMatch && uidMatch[1] !== 'nouid' ? uidMatch[1] : undefined;

  const fetchHeaders: Record<string, string> = {
    Origin: 'https://extract.me',
    Referer: 'https://extract.me/',
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
  if (uid) {
    fetchHeaders.Cookie = `uid=${uid}`;
  }

  // 1. In extract.me, extraction is lazy. Calling download_t triggers the backend
  // engine to decompress this individual file from the archive before download_d is available.
  if (downloadUrl.includes('/download_d/')) {
    const triggerUrl = downloadUrl.replace('/download_d/', '/download_t/');
    try {
      const triggerRes = await fetch(triggerUrl, { headers: fetchHeaders });
      if (!triggerRes.ok) {
        console.warn(`[extractMe] Trigger URL returned status ${triggerRes.status}: ${triggerRes.statusText}`);
      } else {
        await triggerRes.text().catch(() => '');
      }
    } catch (err) {
      console.warn('[extractMe] Error calling trigger URL:', err);
    }
  }

  // 2. Fetch the file from extract.me (with retry on 404/425 in case extraction needs a moment to finish writing)
  let upstreamRes: Response | null = null;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    upstreamRes = await fetch(downloadUrl, { headers: fetchHeaders });
    if (upstreamRes.ok) {
      break;
    }
    if ((upstreamRes.status === 404 || upstreamRes.status === 425) && attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
      continue;
    }
    break;
  }

  if (!upstreamRes || !upstreamRes.ok) {
    const status = upstreamRes ? upstreamRes.status : 500;
    const statusText = upstreamRes ? upstreamRes.statusText : 'No Response';
    throw new Error(`Failed to fetch extracted file from engine: ${status} ${statusText}`);
  }

  const contentType = upstreamRes.headers.get('content-type') || 'application/octet-stream';
  const contentLengthHeader = upstreamRes.headers.get('content-length');
  const totalSize = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;

  // Handle zero-byte files directly without opening a resumable session
  if (totalSize === 0) {
    const emptyFile = await createEmptyDriveFile(env, userId, {
      name: fileName,
      mimeType: contentType,
      folderId: destinationFolderId,
    });
    return {
      fileId: emptyFile.id,
      fileName,
      folderId: destinationFolderId,
    };
  }

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
        // Zero bytes were streamed; create directly in Google Drive
        finalGoogleFile = await createEmptyDriveFile(env, userId, {
          name: fileName,
          mimeType: contentType,
          folderId: destinationFolderId,
        });
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
