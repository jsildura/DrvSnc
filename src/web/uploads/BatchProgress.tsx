import React, { useState } from 'react';
import { BatchView, UploadJobView } from '../../shared/contracts';
import { cancelBatch, retryBatch } from '../api/jobs';

interface BatchProgressProps {
  batch: BatchView;
  onRefresh: () => void;
}

export function BatchProgress({ batch, onRefresh }: BatchProgressProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isActing, setIsActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isTerminal =
    batch.status === 'completed' ||
    batch.status === 'failed' ||
    batch.status === 'canceled' ||
    batch.status === 'partial';

  // Compute percentage
  let percent = 0;
  if (batch.totalKnownBytes > 0) {
    percent = Math.min(100, Math.round((batch.progressBytes / batch.totalKnownBytes) * 100));
  } else if (batch.itemCount > 0) {
    const finished = batch.completedCount + batch.failedCount + batch.canceledCount;
    percent = Math.min(100, Math.round((finished / batch.itemCount) * 100));
  }

  const handleCancel = async () => {
    try {
      setIsActing(true);
      setActionError(null);
      await cancelBatch(batch.id);
      onRefresh();
    } catch (err) {
      setActionError((err as Error).message || 'Failed to cancel batch');
    } finally {
      setIsActing(false);
    }
  };

  const handleRetry = async () => {
    try {
      setIsActing(true);
      setActionError(null);
      await retryBatch(batch.id);
      onRefresh();
    } catch (err) {
      setActionError((err as Error).message || 'Failed to retry batch');
    } finally {
      setIsActing(false);
    }
  };

  const getStatusBadge = () => {
    switch (batch.status) {
      case 'completed':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
            Completed
          </span>
        );
      case 'partial':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
            Partial ({batch.completedCount}/{batch.itemCount})
          </span>
        );
      case 'failed':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
            Failed
          </span>
        );
      case 'canceled':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            Canceled
          </span>
        );
      case 'running':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 animate-pulse">
            Transferring
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
            Queued
          </span>
        );
    }
  };

  return (
    <div className="p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl shadow-sm space-y-4">
      {/* Batch Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-sm">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                Batch Transfer ({batch.itemCount} files)
              </h4>
              {getStatusBadge()}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Destination: {batch.destinationFolderName || 'My Drive (Root)'} •{' '}
              {new Date(batch.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {!isTerminal && (
            <button
              type="button"
              disabled={isActing}
              onClick={handleCancel}
              className="py-1.5 px-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 hover:bg-rose-100 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              Cancel Batch
            </button>
          )}

          {(batch.status === 'failed' || batch.status === 'canceled' || batch.status === 'partial') && (
            <button
              type="button"
              disabled={isActing}
              onClick={handleRetry}
              className="py-1.5 px-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 hover:bg-amber-100 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              Retry Failed ({batch.failedCount + batch.canceledCount})
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <svg
              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {actionError && (
        <p className="text-xs text-rose-500 font-medium">{actionError}</p>
      )}

      {/* Aggregate Progress Bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-400">
          <span>
            {batch.completedCount} completed • {batch.activeCount} active • {batch.failedCount + batch.canceledCount} failed
          </span>
          <span className="font-semibold text-indigo-600 dark:text-indigo-400">{percent}%</span>
        </div>
        <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-blue-600 rounded-full transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* Expanded Child Job Rows */}
      {isExpanded && batch.jobs && batch.jobs.length > 0 && (
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-2">
          <div className="max-h-60 overflow-y-auto space-y-1.5 divide-y divide-slate-100 dark:divide-slate-800/50 pr-1">
            {batch.jobs.map((job: UploadJobView) => (
              <div
                key={job.id}
                className="flex items-center justify-between pt-1.5 first:pt-0 gap-3 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {job.filename}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {job.sourceUrlRedacted || 'Remote URL'}
                  </p>
                  {job.errorMessage && (
                    <p className="text-[11px] text-rose-500 mt-0.5">{job.errorMessage}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {job.status === 'completed' ? (
                    job.driveFileLink ? (
                      <a
                        href={job.driveFileLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                      >
                        <span>Drive</span>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    ) : (
                      <span className="text-emerald-500 font-semibold">Done</span>
                    )
                  ) : job.status === 'uploading' || job.status === 'fetching' ? (
                    <span className="text-indigo-500 animate-pulse font-medium">Uploading</span>
                  ) : job.status === 'failed' ? (
                    <span className="text-rose-500 font-medium">Failed</span>
                  ) : job.status === 'canceled' ? (
                    <span className="text-slate-400">Canceled</span>
                  ) : (
                    <span className="text-blue-500 font-medium">Queued</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
