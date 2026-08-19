import React, { useState } from 'react';
import { UploadJobView } from '../../shared/contracts';
import { cancelJob, retryJob, deleteJobHistory } from '../api/jobs';

interface JobListProps {
  jobs: UploadJobView[];
  onRefresh: () => void;
}

export function JobList({ jobs, onRefresh }: JobListProps) {
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  const activeJobs = jobs.filter((j) =>
    ['staging', 'queued', 'fetching', 'uploading', 'cancel_requested'].includes(j.status)
  );
  const historyJobs = jobs.filter((j) =>
    ['completed', 'failed', 'canceled'].includes(j.status)
  );

  // Every row action is a network call that can fail; without this the rejection
  // is unhandled and the user sees nothing happen at all.
  const runAction = async (
    id: string,
    action: () => Promise<unknown>,
    fallbackMessage: string
  ): Promise<void> => {
    setPendingIds((prev) => new Set(prev).add(id));
    setActionErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

    try {
      await action();
      onRefresh();
    } catch (err) {
      setActionErrors((prev) => ({
        ...prev,
        [id]: (err as Error).message || fallbackMessage,
      }));
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleCancel = (id: string) =>
    runAction(id, () => cancelJob(id), 'Failed to cancel transfer');

  const handleRetry = (id: string) =>
    runAction(id, () => retryJob(id), 'Failed to retry transfer');

  const handleDelete = (id: string) =>
    runAction(id, () => deleteJobHistory(id), 'Failed to remove from history');

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'uploading':
      case 'fetching':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
            {status}
          </span>
        );
      case 'queued':
      case 'staging':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
            {status}
          </span>
        );
      case 'completed':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
            Completed
          </span>
        );
      case 'failed':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
            Failed
          </span>
        );
      case 'canceled':
      case 'cancel_requested':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            Canceled
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-8 relative z-0">
      {/* Active Jobs Section */}
      {activeJobs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
            Active Transfers ({activeJobs.length})
          </h3>
          <div className="space-y-3">
            {activeJobs.map((job) => {
              const progressPct =
                job.fileSize > 0
                  ? Math.min(100, Math.round((job.progressBytes / job.fileSize) * 100))
                  : 0;

              return (
                <div
                  key={job.id}
                  className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-sm space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {job.filename}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {job.sourceKind === 'remote' ? 'Remote Download' : 'Local File'} •{' '}
                        {(job.fileSize / (1024 * 1024)).toFixed(2)} MiB
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {getStatusBadge(job.status)}
                      <button
                        type="button"
                        disabled={pendingIds.has(job.id)}
                        onClick={() => {
                          void handleCancel(job.id);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                        title="Cancel transfer"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>{(job.progressBytes / (1024 * 1024)).toFixed(2)} MiB transferred</span>
                      <span>{progressPct}%</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-blue-600 h-1.5 transition-all duration-300"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  {actionErrors[job.id] && (
                    <p className="text-xs text-rose-500 font-medium">{actionErrors[job.id]}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* History Jobs Section */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
          Transfer History ({historyJobs.length})
        </h3>
        {historyJobs.length === 0 ? (
          <div className="p-8 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/50 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">No transfer history yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {historyJobs.map((job) => (
              <div
                key={job.id}
                className="p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/80 shadow-xs flex items-center justify-between"
              >
                <div className="min-w-0 pr-4">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {job.filename}
                    </p>
                    {getStatusBadge(job.status)}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {(job.fileSize / (1024 * 1024)).toFixed(2)} MiB •{' '}
                    {new Date(job.createdAt).toLocaleDateString()}
                  </p>
                  {job.errorMessage && (
                    <p className="text-xs text-rose-500 mt-1">{job.errorMessage}</p>
                  )}
                  {actionErrors[job.id] && (
                    <p className="text-xs text-rose-500 font-medium mt-1">{actionErrors[job.id]}</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {(job.driveFileLink || job.driveFileId || job.status === 'completed') && (
                    <a
                      href={
                        job.driveFileLink ||
                        (job.driveFileId
                          ? `https://drive.google.com/file/d/${job.driveFileId}/view`
                          : 'https://drive.google.com/drive/my-drive')
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-1.5 px-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-xs font-medium transition-colors inline-flex items-center gap-1.5"
                    >
                      <span>Open in Drive</span>
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  )}

                  {job.status === 'failed' && (
                    <button
                      type="button"
                      disabled={pendingIds.has(job.id)}
                      onClick={() => {
                        void handleRetry(job.id);
                      }}
                      className="py-1.5 px-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 hover:bg-amber-100 text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      Retry
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={pendingIds.has(job.id)}
                    onClick={() => {
                      void handleDelete(job.id);
                    }}
                    title="Remove from history"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
