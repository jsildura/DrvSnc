import {
  UploadJobView,
  CreateRemoteJobRequest,
  CreateLocalJobRequest,
  CreateRelayJobRequest,
  CreateBatchRequest,
  CreateBatchResponse,
  BatchView,
} from '../../shared/contracts';
import { apiRequest } from './client';

export interface StagingSession {
  job: UploadJobView;
  partSize: number;
  partCount: number;
  uploadId: string;
}

export async function createRemoteUploadJob(
  data: CreateRemoteJobRequest,
  idempotencyKey = crypto.randomUUID()
): Promise<UploadJobView> {
  return apiRequest<UploadJobView>('/api/v1/jobs/remote', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(data),
  });
}

export async function initiateLocalUploadJob(
  data: CreateLocalJobRequest,
  idempotencyKey = crypto.randomUUID()
): Promise<StagingSession> {
  return apiRequest<StagingSession>('/api/v1/jobs/local', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(data),
  });
}

/**
 * Open a staging session for a source the browser fetches itself. Same session shape as a local
 * upload, because from R2 onward it is one.
 */
export async function createRelayUploadJob(
  data: CreateRelayJobRequest,
  idempotencyKey = crypto.randomUUID()
): Promise<StagingSession> {
  return apiRequest<StagingSession>('/api/v1/jobs/relay', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(data),
  });
}

export async function getSignPartUrls(
  jobId: string,
  from = 1,
  count = 10
): Promise<{ parts: { partNumber: number; url: string }[] }> {
  return apiRequest<{ parts: { partNumber: number; url: string }[] }>(
    `/api/v1/jobs/${encodeURIComponent(jobId)}/parts?from=${from}&count=${count}`
  );
}

export async function completeLocalUploadJob(
  jobId: string,
  parts: { partNumber: number; etag: string }[],
  /** Bytes actually staged. Required for a relayed stream, whose size was unknown at creation. */
  totalBytes?: number
): Promise<UploadJobView> {
  return apiRequest<UploadJobView>(`/api/v1/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: 'POST',
    body: JSON.stringify(totalBytes ? { parts, totalBytes } : { parts }),
  });
}

export async function listJobs(options?: {
  active?: boolean;
  status?: string;
  since?: string;
  cursor?: string;
  limit?: number;
}): Promise<{ jobs: UploadJobView[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (options?.active !== undefined) params.set('active', String(options.active));
  if (options?.status) params.set('status', options.status);
  if (options?.since) params.set('since', options.since);
  if (options?.cursor) params.set('cursor', options.cursor);
  if (options?.limit) params.set('limit', String(options.limit));

  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<{ jobs: UploadJobView[]; nextCursor: string | null }>(`/api/v1/jobs${query}`);
}

export async function getJob(jobId: string): Promise<UploadJobView> {
  return apiRequest<UploadJobView>(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
}

export async function cancelJob(jobId: string): Promise<UploadJobView> {
  return apiRequest<UploadJobView>(`/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  });
}

export async function retryJob(jobId: string): Promise<UploadJobView> {
  return apiRequest<UploadJobView>(`/api/v1/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
  });
}

export async function deleteJobHistory(jobId: string): Promise<void> {
  await apiRequest(`/api/v1/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  });
}

// ==========================================
// BATCH UPLOAD CLIENT API
// ==========================================

export async function createBatchUpload(
  data: CreateBatchRequest,
  idempotencyKey = crypto.randomUUID()
): Promise<CreateBatchResponse> {
  return apiRequest<CreateBatchResponse>('/api/v1/jobs/batch', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(data),
  });
}

export async function listBatches(options?: {
  limit?: number;
  cursor?: string;
}): Promise<{ batches: BatchView[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.cursor) params.set('cursor', options.cursor);

  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<{ batches: BatchView[]; nextCursor: string | null }>(
    `/api/v1/jobs/batch${query}`
  );
}

export async function getBatch(
  batchId: string
): Promise<{ batch: BatchView; jobs: UploadJobView[] }> {
  return apiRequest<{ batch: BatchView; jobs: UploadJobView[] }>(
    `/api/v1/jobs/batch/${encodeURIComponent(batchId)}`
  );
}

export async function cancelBatch(
  batchId: string
): Promise<{ batch: BatchView; jobs: UploadJobView[] }> {
  return apiRequest<{ batch: BatchView; jobs: UploadJobView[] }>(
    `/api/v1/jobs/batch/${encodeURIComponent(batchId)}/cancel`,
    {
      method: 'POST',
    }
  );
}

export async function retryBatch(
  batchId: string
): Promise<{ batch: BatchView; jobs: UploadJobView[] }> {
  return apiRequest<{ batch: BatchView; jobs: UploadJobView[] }>(
    `/api/v1/jobs/batch/${encodeURIComponent(batchId)}/retry`,
    {
      method: 'POST',
    }
  );
}
