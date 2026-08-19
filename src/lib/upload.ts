// Upload orchestration for both URL and local file sources
import type { UploadJob, ServiceConfig, GitHubConfig } from './types';
import { isCorsError, getCorsErrorMessage } from './cors';
import { uploadSmallFile, initiateResumableUpload, uploadChunk } from './drive';
import { uploadViaGitHubActions } from './githubActions';

const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB chunks
const SMALL_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB

// Server-side upload configuration
let serverConfig: ServiceConfig | null = null;
let githubConfig: GitHubConfig | null = null;

export function setServerConfig(config: ServiceConfig | null) {
  serverConfig = config;
}

export function getServerConfig(): ServiceConfig | null {
  return serverConfig;
}

export function setGitHubConfig(config: GitHubConfig | null) {
  githubConfig = config;
}

export function getGitHubConfig(): GitHubConfig | null {
  return githubConfig;
}

// Utility to concatenate Uint8Arrays
function concatUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result: Uint8Array = new Uint8Array(a.length + b.length);
  result.set(new Uint8Array(a), 0);
  result.set(new Uint8Array(b), a.length);
  return result;
}

export class UploadManager {
  private controllers = new Map<string, AbortController>();

  async uploadFromUrl(
    job: UploadJob,
    token: string,
    onProgress: (update: Partial<UploadJob>) => void
  ): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);

    try {
      // 1. Probe URL
      onProgress({ status: 'downloading', bytesRead: 0 });

      let total: number | undefined;
      try {
        const head = await fetch(job.url!, { method: 'HEAD', signal: controller.signal });
        total = Number(head.headers.get('content-length')) || undefined;
      } catch (e) {
        // HEAD may fail, proceed with GET
      }

      // 2. Start download
      const response = await fetch(job.url!, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Update with total if known
      if (total) {
        onProgress({ bytesTotal: total });
      }

      // 3. Decide upload strategy based on size
      if (total && total < SMALL_FILE_THRESHOLD) {
        // Small file: read all and use multipart upload
        await this.uploadSmallFromStream(job, token, response.body, controller, onProgress);
      } else {
        // Large file or unknown size: use resumable upload
        await this.uploadResumableFromStream(job, token, response.body, total, controller, onProgress);
      }
    } catch (error: any) {
      if (controller.signal.aborted) {
        onProgress({ status: 'canceled' });
      } else if (isCorsError(error)) {
        onProgress({ status: 'failed', error: getCorsErrorMessage(job.url!) });
      } else {
        onProgress({ status: 'failed', error: error.message || 'Upload failed' });
      }
      throw error;
    } finally {
      this.controllers.delete(job.id);
    }
  }

  async uploadFromLocalFile(
    job: UploadJob,
    token: string,
    blob: Blob,
    onProgress: (update: Partial<UploadJob>) => void
  ): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);

    try {
      onProgress({ status: 'uploading', bytesTotal: blob.size, bytesRead: blob.size });

      if (blob.size < SMALL_FILE_THRESHOLD) {
        // Small file: use multipart
        const result = await uploadSmallFile(token, job.filename, job.destFolderId, blob, blob.type, controller.signal);
        onProgress({
          status: 'completed',
          bytesSent: blob.size,
          driveFileId: result.id,
          driveFileUrl: result.webViewLink,
        });
      } else {
        // Large file: use resumable upload
        const sessionUrl = await initiateResumableUpload(token, job.filename, job.destFolderId, blob.type, controller.signal);

        let uploaded = 0;
        const chunkCount = Math.ceil(blob.size / CHUNK_SIZE);

        for (let i = 0; i < chunkCount; i++) {
          if (controller.signal.aborted) {
            onProgress({ status: 'canceled' });
            return;
          }

          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, blob.size);
          const chunk = blob.slice(start, end);
          const arrayBuffer = await chunk.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);

          const result = await uploadChunk(sessionUrl, uint8Array, uploaded, blob.size, token, controller.signal);
          uploaded += uint8Array.length;

          onProgress({ bytesSent: uploaded });

          if (result.done) {
            onProgress({
              status: 'completed',
              driveFileId: result.fileId,
              driveFileUrl: result.webViewLink,
            });
            return;
          }
        }
      }
    } catch (error: any) {
      if (controller.signal.aborted) {
        onProgress({ status: 'canceled' });
      } else {
        onProgress({ status: 'failed', error: error.message || 'Upload failed' });
      }
      throw error;
    } finally {
      this.controllers.delete(job.id);
    }
  }

  private async uploadSmallFromStream(
    job: UploadJob,
    token: string,
    stream: ReadableStream<Uint8Array>,
    controller: AbortController,
    onProgress: (update: Partial<UploadJob>) => void
  ): Promise<void> {
    const reader = stream.getReader();
    const chunks: ArrayBuffer[] = [];
    let totalRead = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (controller.signal.aborted) {
          reader.cancel();
          return;
        }
        chunks.push(value.buffer as ArrayBuffer);
        totalRead += value.length;
        onProgress({ bytesRead: totalRead });
      }
    } finally {
      reader.releaseLock();
    }

    // Combine all chunks
    const blob = new Blob(chunks);

    onProgress({ status: 'uploading', bytesSent: 0 });

    const result = await uploadSmallFile(token, job.filename, job.destFolderId, blob, undefined, controller.signal);

    onProgress({
      status: 'completed',
      bytesSent: totalRead,
      driveFileId: result.id,
      driveFileUrl: result.webViewLink,
    });
  }

  private async uploadResumableFromStream(
    job: UploadJob,
    token: string,
    stream: ReadableStream<Uint8Array>,
    total: number | undefined,
    controller: AbortController,
    onProgress: (update: Partial<UploadJob>) => void
  ): Promise<void> {
    const sessionUrl = await initiateResumableUpload(token, job.filename, job.destFolderId, undefined, controller.signal);

    onProgress({ status: 'uploading' });

    const reader = stream.getReader();
    let buffer: Uint8Array = new Uint8Array(0);
    let uploaded = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          buffer = concatUint8Arrays(buffer, new Uint8Array(value));
          onProgress({ bytesRead: uploaded + buffer.length });
        }

        if (done || buffer.length >= CHUNK_SIZE) {
          if (controller.signal.aborted) {
            reader.cancel();
            return;
          }

          if (buffer.length > 0) {
            const chunkToSend = buffer.slice(0, Math.min(CHUNK_SIZE, buffer.length));
            const result = await uploadChunk(sessionUrl, chunkToSend, uploaded, total, token, controller.signal);
            uploaded += chunkToSend.length;
            buffer = buffer.slice(chunkToSend.length);

            onProgress({ bytesSent: uploaded });

            if (result.done) {
              onProgress({
                status: 'completed',
                driveFileId: result.fileId,
                driveFileUrl: result.webViewLink,
              });
              return;
            }
          }

          if (done && buffer.length === 0) break;
        }

        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
  }

  cancel(jobId: string): void {
    const controller = this.controllers.get(jobId);
    if (controller) {
      controller.abort();
      this.controllers.delete(jobId);
    }
  }

  /**
   * Upload from URL via Cloud Run service (server-side)
   * This bypasses CORS and client-side limitations
   */
  async uploadFromUrlViaServer(
    job: UploadJob,
    config: ServiceConfig,
    onProgress: (update: Partial<UploadJob>) => void
  ): Promise<void> {
    if (!config.enabled || !config.cloudRunUrl || !config.appKey) {
      throw new Error('Server upload is not properly configured');
    }

    const controller = new AbortController();
    this.controllers.set(job.id, controller);

    try {
      onProgress({ 
        status: 'uploading', 
        bytesRead: 0,
        bytesSent: 0 
      });

      const requestBody = {
        url: job.url,
        filename: job.filename,
        parentFolderId: job.destFolderId === 'root' ? undefined : job.destFolderId,
      };

      const response = await fetch(`${config.cloudRunUrl}/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.appKey}`
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || data?.error || `Server upload failed: ${response.status}`);
      }

      // Update job with success
      onProgress({
        status: 'completed',
        driveFileId: data.fileId,
        driveFileUrl: data.webViewLink || `https://drive.google.com/file/d/${data.fileId}/view`,
        bytesSent: job.bytesTotal || 0
      });

    } catch (error: any) {
      if (controller.signal.aborted) {
        onProgress({ status: 'canceled' });
      } else {
        const errorMessage = error.message || 'Server upload failed';
        onProgress({ 
          status: 'failed', 
          error: errorMessage
        });
      }
      throw error;
    } finally {
      this.controllers.delete(job.id);
    }
  }

  /**
   * Upload from URL via GitHub Actions (free, no credit card)
   * This bypasses CORS and uses GitHub runners for the transfer
   */
  async uploadFromUrlViaGitHubActions(
    job: UploadJob,
    config: GitHubConfig,
    accountKey?: string,
    parentKey?: string,
    onProgress?: (update: Partial<UploadJob>) => void,
    accountEmail?: string
  ): Promise<void> {
    if (!config.enabled || !config.owner || !config.repo || !config.token) {
      throw new Error('GitHub Actions upload is not properly configured');
    }

    try {
      onProgress?.({ status: 'uploading', bytesRead: 0, bytesSent: 0 });

      let detectedFileSize: number | undefined;
      let workflowProgress = 0;

      // Debug: Log what we're about to send
      console.log('=== DEBUG: Upload Manager ===');
      console.log('Job details:');
      console.log('  Job URL:', job.url);
      console.log('  Job filename:', job.filename);
      console.log('  Job destFolderId:', job.destFolderId);
      console.log('  Calculated parentFolderId:', job.destFolderId && job.destFolderId !== 'root' ? job.destFolderId : undefined);
      console.log('===========================');

      // Upload via GitHub Actions with progress callbacks
      const result = await uploadViaGitHubActions(
        config,
        {
          url: job.url!,
          filename: job.filename,
          accountKey: accountKey || config.defaultAccountKey,
          parentKey: parentKey || config.defaultParentKey,
          parentFolderId: job.destFolderId && job.destFolderId !== 'root' ? job.destFolderId : undefined,
          accountEmail: accountEmail
        },
        (percent, message) => {
          // Extract file size from message if present
          const sizeMatch = message.match(/(\d+\.?\d*)\s*MB/);
          if (sizeMatch && !detectedFileSize) {
            detectedFileSize = parseFloat(sizeMatch[1]) * 1024 * 1024;
            onProgress?.({ bytesTotal: Math.round(detectedFileSize) });
          }
          
          workflowProgress = percent;
          const currentTotal = detectedFileSize || job.bytesTotal;
          
          // For GitHub Actions, store progress percentage in a custom field
          // and set bytes to match the percentage for visual consistency
          onProgress?.({
            bytesRead: currentTotal ? Math.floor((currentTotal * percent) / 100) : percent,
            bytesSent: currentTotal ? Math.floor((currentTotal * percent) / 100) : percent,
            bytesTotal: currentTotal || 100, // If no size detected, use 100 as base for percentage
            // Store workflow progress for accurate progress bar
            ...(job as any).workflowProgress !== undefined ? { workflowProgress: percent } : {}
          });
        }
      );

      // Update job with success
      onProgress?.({
        status: 'completed',
        driveFileId: result.fileId,
        driveFileUrl: result.webViewLink || `https://drive.google.com/file/d/${result.fileId}/view`,
        bytesSent: result.size ? parseInt(result.size) : job.bytesTotal || 0
      });

    } catch (error: any) {
      const errorMessage = error.message || 'GitHub Actions upload failed';
      onProgress?.({ 
        status: 'failed', 
        error: errorMessage
      });
      throw error;
    }
  }
}
