import { Env } from '../env';
import { logAuditEvent } from '../services/audit';

export interface CleanupResult {
  expiredSessions: number;
  expiredStates: number;
  redactedJobs: number;
  removedBatches: number;
}

export async function handleScheduledCleanup(env: Env): Promise<CleanupResult> {
  const result: CleanupResult = {
    expiredSessions: 0,
    expiredStates: 0,
    redactedJobs: 0,
    removedBatches: 0,
  };

  const nowIso = new Date().toISOString();
  const ninetyDaysAgoIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  try {
    // 1. Expire stale sessions (older than 30 days / expired)
    const sessionRes = await env.DB.prepare(
      `DELETE FROM sessions WHERE expires_at < ?`
    )
      .bind(nowIso)
      .run();
    result.expiredSessions = sessionRes.meta.changes || 0;

    // 2. Expire stale OAuth PKCE states (older than 10 mins / expired)
    const statesRes = await env.DB.prepare(
      `DELETE FROM oauth_states WHERE expires_at < ?`
    )
      .bind(nowIso)
      .run();
    result.expiredStates = statesRes.meta.changes || 0;

    // 3. Redact 90-day-old job details for privacy compliance
    const redactRes = await env.DB.prepare(
      `UPDATE upload_jobs
       SET source_url_encrypted = NULL,
           error_message = NULL
       WHERE created_at < ?
         AND (source_url_encrypted IS NOT NULL OR error_message IS NOT NULL)`
    )
      .bind(ninetyDaysAgoIso)
      .run();
    result.redactedJobs = redactRes.meta.changes || 0;

    // 4. Reclaim batch rows that no longer have child jobs (children were
    //    deleted through job history deletion or account-level cascades).
    const batchesRes = await env.DB.prepare(
      `DELETE FROM upload_batches
       WHERE NOT EXISTS (
         SELECT 1 FROM upload_jobs WHERE upload_jobs.batch_id = upload_batches.id
       )`
    ).run();
    result.removedBatches = batchesRes.meta.changes || 0;

    await logAuditEvent(env, {
      action: 'scheduled_cleanup',
      status: 'success',
      details: {
        expiredSessions: result.expiredSessions,
        expiredStates: result.expiredStates,
        redactedJobs: result.redactedJobs,
        removedBatches: result.removedBatches,
      },
    });
  } catch (err) {
    await logAuditEvent(env, {
      action: 'scheduled_cleanup',
      status: 'failure',
      details: { error: (err as Error).message },
    });
    throw err;
  }

  return result;
}
