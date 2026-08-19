import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { Env } from '../env';
import { decryptSecret } from '../services/crypto';
import { startResumableUpload, uploadChunk, queryResumableOffset } from '../services/driveClient';
import { fetchRemoteWithPolicy } from '../services/remoteUrlPolicy';
import { deleteR2Object } from '../services/r2Multipart';
import { isTerminalStatus, UploadJobStatus } from '../../shared/jobState';

const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB bounded chunks

export class TransferError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'TransferError';
  }
}

export interface TransferPayload {
  jobId: string;
  userId: string;
  attemptNumber?: number;
}

export interface StepRunner {
  do: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}

type PrepResult =
  | { kind: 'canceled' }
  | { kind: 'terminal' }
  | {
      kind: 'ready';
      sessionUrl: string;
      totalSize: number;
      sourceKind: string;
      r2ObjectKey: string | null;
      sourceUrl: string;
      filename: string;
    };

type ChunkResult =
  | { completed: false; bytesTransferred: number }
  | {
      completed: true;
      bytesTransferred: number;
      googleFile: { id: string; webViewLink?: string };
    };

/**
 * Google answers an incomplete resumable chunk with `308` and a
 * `Range: bytes=0-<lastByte>` header naming the last byte it actually stored.
 * That is authoritative — the request may have been truncated — so prefer it
 * over assuming the whole chunk landed.
 */
function confirmedBytes(rangeHeader: string | null, offset: number, sentLength: number): number {
  if (!rangeHeader) return sentLength;
  const match = /bytes=0-(-?\d+)/.exec(rangeHeader);
  if (!match) return sentLength;
  const lastByte = parseInt(match[1], 10);
  if (!Number.isFinite(lastByte)) return sentLength;
  const accepted = lastByte + 1 - offset;
  if (accepted <= 0 || accepted > sentLength) return sentLength;
  return accepted;
}

export async function runDriveTransfer(
  env: Env,
  payload: TransferPayload,
  step: StepRunner
): Promise<void> {
  const { jobId, userId } = payload;
  const attemptNumber = payload.attemptNumber ?? 1;

  const markCanceled = async (): Promise<void> => {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE upload_jobs
         SET status = 'canceled', updated_at = ?, version = version + 1
         WHERE id = ? AND user_id = ?
           AND status IN ('staging', 'queued', 'fetching', 'uploading', 'cancel_requested')`
      ).bind(now, jobId, userId),
      env.DB.prepare(
        `UPDATE upload_attempts
         SET status = 'canceled', finished_at = ?
         WHERE job_id = ? AND attempt_number = ?
           AND status NOT IN ('completed', 'failed', 'canceled')`
      ).bind(now, jobId, attemptNumber),
    ]);
  };

  try {
    // Step 1: Preparation & Resumable Session Start
    const prep = await step.do('prepare-transfer', async (): Promise<PrepResult> => {
      const job = await env.DB.prepare(
        'SELECT * FROM upload_jobs WHERE id = ? AND user_id = ?'
      )
        .bind(jobId, userId)
        .first<{
          id: string;
          user_id: string;
          source_kind: string;
          source_url_encrypted: string | null;
          source_url_iv: string | null;
          r2_object_key: string | null;
          filename: string;
          file_size: number;
          mime_type: string;
          destination_folder_id: string | null;
          status: string;
          version: number;
        }>();

      if (!job) {
        throw new Error(`Upload job ${jobId} not found`);
      }

      if (job.status === 'cancel_requested' || job.status === 'canceled') {
        await markCanceled();
        return { kind: 'canceled' };
      }

      if (isTerminalStatus(job.status as UploadJobStatus)) {
        return { kind: 'terminal' };
      }

      let sourceUrl = '';
      let totalSize = Number(job.file_size || 0);
      let mimeType = job.mime_type || 'application/octet-stream';

      if (job.source_kind === 'remote' && job.source_url_encrypted && job.source_url_iv) {
        sourceUrl = await decryptSecret(
          job.source_url_encrypted,
          job.source_url_iv,
          env.TOKEN_ENCRYPTION_KEY,
          userId
        );

        if (totalSize === 0) {
          try {
            const probe = await fetchRemoteWithPolicy(sourceUrl, { method: 'HEAD' });
            const cl = probe.headers.get('Content-Length');
            if (cl) totalSize = parseInt(cl, 10);
            const ct = probe.headers.get('Content-Type');
            if (ct) mimeType = ct;
          } catch (_err) {
            // Probe failed, fallback
          }

          // Generated downloads (Seedr's folder zips, for one) answer HEAD without a
          // Content-Length. Asking for a single byte gets the total from the 206's
          // Content-Range instead, which is all the chunk loop needs to get going.
          if (!Number.isFinite(totalSize) || totalSize <= 0) {
            try {
              const ranged = await fetchRemoteWithPolicy(sourceUrl, {
                headers: { Range: 'bytes=0-0' },
              });
              const contentRange = ranged.headers.get('Content-Range');
              const declaredTotal = contentRange?.match(/\/\s*(\d+)\s*$/);
              if (declaredTotal) totalSize = parseInt(declaredTotal[1], 10);
              const ct = ranged.headers.get('Content-Type');
              if (ct && mimeType === 'application/octet-stream') mimeType = ct;
              // Never read the body: a server that ignored the Range is answering
              // with the whole file.
              await ranged.body?.cancel().catch(() => undefined);
            } catch (_err) {
              // Falls through to REMOTE_SIZE_UNKNOWN below
            }
          }
        }
      }

      if (job.source_kind === 'remote' && (!Number.isFinite(totalSize) || totalSize <= 0)) {
        throw new TransferError(
          'REMOTE_SIZE_UNKNOWN',
          'The remote server did not provide a valid file size'
        );
      }

      // Start Google Drive resumable upload session
      const sessionUrl = await startResumableUpload(env, userId, {
        name: job.filename,
        mimeType,
        folderId: job.destination_folder_id || undefined,
      });

      const now = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE upload_jobs
         SET status = 'uploading', resumable_upload_uri = ?, file_size = ?, mime_type = ?,
             updated_at = ?, version = version + 1
         WHERE id = ? AND version = ?`
      )
        .bind(sessionUrl, totalSize, mimeType, now, jobId, job.version)
        .run();

      return {
        kind: 'ready',
        sessionUrl,
        totalSize,
        sourceKind: job.source_kind,
        r2ObjectKey: job.r2_object_key,
        sourceUrl,
        filename: job.filename,
      };
    });

    if (prep.kind !== 'ready') {
      return;
    }

    const { sessionUrl, totalSize, sourceKind, r2ObjectKey, sourceUrl } = prep;
    let offset = 0;

    // Check existing Google offset if resuming
    try {
      if (totalSize > 0) {
        offset = await queryResumableOffset(sessionUrl, totalSize);
      }
    } catch (_err) {
      offset = 0;
    }

    let chunkIndex = Math.floor(offset / CHUNK_SIZE);
    let completedGoogleFile: { id: string; webViewLink?: string } | null = null;

    // Step 2: Bounded Chunk Transfers
    while (offset < totalSize) {
      const currentChunkLength = Math.min(CHUNK_SIZE, totalSize - offset);
      const chunkNumber = chunkIndex + 1;

      // Check cancellation before chunk transfer
      const currentJobState = await env.DB.prepare(
        'SELECT status FROM upload_jobs WHERE id = ?'
      )
        .bind(jobId)
        .first<{ status: string }>();

      if (currentJobState?.status === 'cancel_requested' || currentJobState?.status === 'canceled') {
        await markCanceled();

        if (r2ObjectKey) {
          await deleteR2Object(env, r2ObjectKey);
        }
        return;
      }

      const chunkResult = await step.do(
        `upload-chunk-${chunkNumber}`,
        async (): Promise<ChunkResult> => {
          let chunkBytes: ArrayBuffer;

          if (sourceKind === 'local' && r2ObjectKey) {
            const r2Obj = await env.UPLOADS.get(r2ObjectKey, {
              range: { offset, length: currentChunkLength },
            });
            if (!r2Obj) {
              throw new Error(`R2 staging object ${r2ObjectKey} not found`);
            }
            chunkBytes = await r2Obj.arrayBuffer();
          } else {
            const remoteResp = await fetchRemoteWithPolicy(sourceUrl, {
              headers: {
                Range: `bytes=${offset}-${offset + currentChunkLength - 1}`,
              },
            });

            // A non-206 answer means the Range was ignored, so the body starts
            // at byte 0 rather than at `offset`. Uploading it would corrupt the
            // file, so only accept that when we are at the start of the stream.
            if (offset > 0 && remoteResp.status !== 206) {
              throw new TransferError(
                'REMOTE_RANGE_UNSUPPORTED',
                'The remote server does not support ranged requests required for chunked transfer'
              );
            }

            const body = await remoteResp.arrayBuffer();
            chunkBytes =
              body.byteLength > currentChunkLength ? body.slice(0, currentChunkLength) : body;
          }

          const sentLength = chunkBytes.byteLength;
          if (sentLength === 0) {
            throw new TransferError(
              'SOURCE_CHUNK_EMPTY',
              `The source returned no data at offset ${offset}`
            );
          }

          const uploadRes = await uploadChunk(sessionUrl, chunkBytes, offset, totalSize);

          if (uploadRes.status === 200 || uploadRes.status === 201) {
            const googleFile = (await uploadRes.json()) as { id: string; webViewLink?: string };
            return {
              completed: true,
              bytesTransferred: sentLength,
              googleFile,
            };
          }

          if (uploadRes.status === 308) {
            return {
              completed: false,
              bytesTransferred: confirmedBytes(uploadRes.headers.get('Range'), offset, sentLength),
            };
          }

          throw new Error(`Google upload chunk failed with status ${uploadRes.status}`);
        }
      );

      if (chunkResult.bytesTransferred <= 0) {
        throw new TransferError(
          'TRANSFER_STALLED',
          `Google Drive accepted no bytes at offset ${offset}`
        );
      }

      offset += chunkResult.bytesTransferred;
      chunkIndex++;

      // Throttled D1 progress update
      await env.DB.prepare(
        `UPDATE upload_jobs
         SET progress_bytes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
        .bind(offset, jobId)
        .run();

      if (chunkResult.completed) {
        completedGoogleFile = chunkResult.googleFile;
        break;
      }
    }

    // Step 3: Completion & Cleanup
    await step.do('finalize-transfer', async () => {
      if (!completedGoogleFile?.id) {
        throw new TransferError(
          'DRIVE_UPLOAD_INCOMPLETE',
          'Google Drive did not confirm the uploaded file'
        );
      }

      const driveFileId = completedGoogleFile.id;
      const driveFileLink =
        completedGoogleFile.webViewLink ||
        `https://drive.google.com/file/d/${driveFileId}/view`;
      const now = new Date().toISOString();

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE upload_jobs
           SET status = 'completed', drive_file_id = ?, drive_file_link = ?,
               progress_bytes = file_size, updated_at = ?, version = version + 1
           WHERE id = ? AND user_id = ? AND status = 'uploading'`
        ).bind(driveFileId, driveFileLink, now, jobId, userId),
        env.DB.prepare(
          `UPDATE upload_attempts
           SET status = 'completed', bytes_transferred = ?, finished_at = ?
           WHERE job_id = ? AND attempt_number = ?
             AND status NOT IN ('completed', 'failed', 'canceled')
             AND EXISTS (
               SELECT 1 FROM upload_jobs
               WHERE id = ? AND user_id = ? AND status = 'completed'
             )`
        ).bind(totalSize, now, jobId, attemptNumber, jobId, userId),
      ]);

      const finalJob = await env.DB.prepare(
        'SELECT status FROM upload_jobs WHERE id = ? AND user_id = ?'
      )
        .bind(jobId, userId)
        .first<{ status: string }>();

      if (finalJob?.status === 'cancel_requested') {
        await markCanceled();
        return;
      }

      if (finalJob?.status === 'canceled') {
        return;
      }

      if (finalJob?.status !== 'completed') {
        throw new TransferError(
          'JOB_STATE_CONFLICT',
          'Upload job changed state during finalization'
        );
      }

      // Clean up R2 staging if applicable
      if (r2ObjectKey) {
        await deleteR2Object(env, r2ObjectKey);
      }
    });
  } catch (err: unknown) {
    const errorMsg = (err as Error).message || 'Drive transfer failed';
    const errorCode = (err as { code?: string }).code || 'TRANSFER_FAILED';
    const now = new Date().toISOString();

    try {
      const currentState = await env.DB.prepare(
        'SELECT status FROM upload_jobs WHERE id = ?'
      )
        .bind(jobId)
        .first<{ status: string }>();

      if (currentState?.status === 'cancel_requested') {
        await markCanceled();
      } else {
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE upload_jobs
             SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, version = version + 1
             WHERE id = ? AND user_id = ?
               AND status NOT IN ('completed', 'failed', 'canceled')`
          ).bind(errorCode, errorMsg, now, jobId, userId),
          env.DB.prepare(
            `UPDATE upload_attempts
             SET status = 'failed', error_code = ?, error_message = ?, finished_at = ?
             WHERE job_id = ? AND attempt_number = ?
               AND status NOT IN ('completed', 'failed', 'canceled')
               AND EXISTS (
                 SELECT 1 FROM upload_jobs
                 WHERE id = ? AND user_id = ? AND status = 'failed'
               )`
          ).bind(errorCode, errorMsg, now, jobId, attemptNumber, jobId, userId),
        ]);
      }
    } catch {
      // Ignore secondary DB error
    }

    throw err;
  }
}

export class DriveTransferWorkflow extends WorkflowEntrypoint<Env, TransferPayload> {
  async run(event: WorkflowEvent<TransferPayload>, step: WorkflowStep) {
    await runDriveTransfer(this.env, event.payload, step);
  }
}
