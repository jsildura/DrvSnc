export const uploadJobStatuses = [
  'staging',
  'queued',
  'fetching',
  'uploading',
  'completed',
  'failed',
  'cancel_requested',
  'canceled',
] as const;

export type UploadJobStatus = (typeof uploadJobStatuses)[number];

const ALLOWED_TRANSITIONS: Record<UploadJobStatus, readonly UploadJobStatus[]> = {
  staging: ['queued', 'canceled', 'failed'],
  queued: ['fetching', 'uploading', 'cancel_requested', 'failed'],
  fetching: ['uploading', 'cancel_requested', 'failed'],
  uploading: ['completed', 'cancel_requested', 'failed'],
  cancel_requested: ['canceled', 'completed', 'failed'],
  failed: ['queued'],
  completed: [],
  canceled: [],
};

const TERMINAL_STATUSES = new Set<UploadJobStatus>([
  'completed',
  'failed',
  'canceled',
]);

export function canTransition(from: UploadJobStatus, to: UploadJobStatus): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function assertTransition(from: UploadJobStatus, to: UploadJobStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal job state transition from '${from}' to '${to}'`);
  }
}

export function isTerminalStatus(status: UploadJobStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
