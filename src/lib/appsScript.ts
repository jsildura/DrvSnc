import type { UploadJob } from './types';

/**
 * Get file size from URL without downloading
 */
async function getFileSizeFromUrl(url: string): Promise<number | undefined> {
  try {
    console.log('[getFileSizeFromUrl] Detecting file size for:', url);
    
    // Try HEAD request first
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
    });
    
    if (!response.ok) {
      console.warn('[getFileSizeFromUrl] HEAD request failed, trying GET with range');
      // Fallback: Try GET with Range header
      const rangeResponse = await fetch(url, {
        headers: { 'Range': 'bytes=0-0' }
      });
      
      const contentRange = rangeResponse.headers.get('content-range');
      if (contentRange) {
        const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
        if (match) {
          const size = parseInt(match[1]);
          console.log('[getFileSizeFromUrl] Got size from content-range:', size);
          return size;
        }
      }
    }
    
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const size = parseInt(contentLength);
      console.log('[getFileSizeFromUrl] Got size from content-length:', size);
      return size;
    }
    
    console.warn('[getFileSizeFromUrl] Could not detect file size');
    return undefined;
  } catch (error) {
    console.error('[getFileSizeFromUrl] Error detecting file size:', error);
    return undefined;
  }
}

/**
 * Simulate upload progress for Apps Script (since it doesn't provide real progress)
 */
function simulateProgress(
  fileSize: number,
  onProgress: (update: Partial<UploadJob>) => void,
  totalBytes: number
): { stop: () => void } {
  let currentBytes = 0;
  let stopped = false;
  
  // Simulate progress at realistic speed (assume ~5 MB/s for Apps Script)
  const bytesPerSecond = 5 * 1024 * 1024;
  const updateInterval = 500; // Update every 500ms
  const bytesPerUpdate = (bytesPerSecond * updateInterval) / 1000;
  
  const intervalId = setInterval(() => {
    if (stopped) {
      clearInterval(intervalId);
      return;
    }
    
    currentBytes = Math.min(currentBytes + bytesPerUpdate, fileSize * 0.95); // Cap at 95%
    
    onProgress({
      status: 'uploading',
      bytesSent: Math.round(currentBytes),
      bytesTotal: totalBytes,
    });
  }, updateInterval);
  
  return {
    stop: () => {
      stopped = true;
      clearInterval(intervalId);
    }
  };
}

/**
 * Uploads a file from a URL via a Google Apps Script web app.
 *
 * @param job - The upload job details.
 * @param appsScriptUrl - The URL of the deployed Google Apps Script web app.
 * @param onProgress - A callback function to report progress.
 * @returns A promise that resolves when the upload is complete.
 */
export async function uploadViaAppsScript(
  job: UploadJob,
  appsScriptUrl: string,
  onProgress: (update: Partial<UploadJob>) => void
): Promise<void> {
  const { id, url, filename, destFolderId } = job;

  if (!url) {
    throw new Error('URL is missing from the job.');
  }

  let progressSimulator: { stop: () => void } | null = null;

  try {
    // Step 1: Detect file size
    console.log(`[uploadViaAppsScript] Starting upload for job ${id}`);
    onProgress({ status: 'uploading', bytesSent: 0 });
    
    const fileSize = await getFileSizeFromUrl(url);
    
    if (fileSize) {
      const sizeMB = (fileSize / (1024 * 1024)).toFixed(2);
      console.log(`[uploadViaAppsScript] Detected file size: ${sizeMB} MB`);
      
      // Update job with total size
      onProgress({
        status: 'uploading',
        bytesSent: 0,
        bytesTotal: fileSize,
      });
      
      // Start simulating progress
      progressSimulator = simulateProgress(fileSize, onProgress, fileSize);
    } else {
      console.log('[uploadViaAppsScript] File size unknown, using indeterminate progress');
    }

    // Step 2: Send to Apps Script
    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        filename,
        parentFolderId: destFolderId,
      }),
    });

    // Stop progress simulation
    if (progressSimulator) {
      progressSimulator.stop();
    }

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[uploadViaAppsScript] Error response from Apps Script:', errorText);
        throw new Error(`Apps Script upload failed with status: ${response.status}. Check the Apps Script logs for details.`);
    }
    
    const result = await response.json();

    if (result.status === 'error') {
      console.error('[uploadViaAppsScript] Apps Script returned an error:', result);
      throw new Error(`Apps Script error: ${result.message}`);
    }

    if (result.status !== 'success' || !result.file?.id) {
        throw new Error('Invalid or incomplete response from Apps Script.');
    }

    console.log('[uploadViaAppsScript] Upload successful:', result.file);

    // Update the job state to 'completed'
    onProgress({
      status: 'completed',
      driveFileId: result.file.id,
      driveFileUrl: result.file.webViewLink,
      bytesSent: fileSize || job.bytesTotal || 100,
      bytesTotal: fileSize || job.bytesTotal || 100,
    });

  } catch (error: any) {
    // Stop progress simulation on error
    if (progressSimulator) {
      progressSimulator.stop();
    }
    console.error('[uploadViaAppsScript] Failed to upload:', error);
    throw error;
  }
}
