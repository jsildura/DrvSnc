import { Env } from '../env';

export interface AuditEvent {
  userId?: string;
  action: string;
  resourceId?: string;
  status: 'success' | 'failure';
  details?: Record<string, unknown>;
  ip?: string;
}

export async function logAuditEvent(
  _env: Env,
  event: AuditEvent
): Promise<void> {
  const timestamp = new Date().toISOString();
  const safeUserId = event.userId ? `usr_${event.userId.slice(-6)}` : 'anonymous';

  // Scrub any sensitive properties from details
  const safeDetails: Record<string, unknown> = {};
  if (event.details) {
    for (const [key, value] of Object.entries(event.details)) {
      const lower = key.toLowerCase();
      if (
        lower.includes('token') ||
        lower.includes('secret') ||
        lower.includes('password') ||
        lower.includes('auth') ||
        lower.includes('cookie')
      ) {
        safeDetails[key] = '[REDACTED]';
      } else {
        safeDetails[key] = value;
      }
    }
  }

  const logPayload = {
    tag: 'GDU_AUDIT',
    timestamp,
    userHash: safeUserId,
    action: event.action,
    resourceId: event.resourceId,
    status: event.status,
    details: safeDetails,
  };

  // Structured console log for Cloudflare logpush/observability
  console.log(JSON.stringify(logPayload));
}
