import React, { useState, useEffect, useCallback } from 'react';
import { UploadJobView, BatchView } from '../../shared/contracts';
import { listJobs, listBatches } from '../api/jobs';
import { UploadForm } from '../uploads/UploadForm';
import { JobList } from '../uploads/JobList';
import { BatchProgress } from '../uploads/BatchProgress';

export function UploaderPage() {
  const [jobs, setJobs] = useState<UploadJobView[]>([]);
  const [batches, setBatches] = useState<BatchView[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [jobsRes, batchesRes] = await Promise.all([
        listJobs({ limit: 50 }).catch(() => ({ jobs: [], nextCursor: null })),
        listBatches({ limit: 10 }).catch(() => ({ batches: [], nextCursor: null })),
      ]);
      setJobs(Array.isArray(jobsRes?.jobs) ? jobsRes.jobs : []);
      setBatches(Array.isArray(batchesRes?.batches) ? batchesRes.batches : []);
    } catch {
      // Ignore network polling glitches
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Poll every 2 seconds if there are active jobs/batches or on page mount
    const interval = setInterval(() => {
      fetchData();
    }, 2000);

    return () => clearInterval(interval);
  }, [fetchData]);

  // Active batches (not fully completed/canceled/failed)
  const safeBatches = Array.isArray(batches) ? batches : [];
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const activeBatches = safeBatches.filter((b) => b.status === 'running' || b.status === 'queued');
  // Standalone jobs (not part of an active batch)
  const standaloneJobs = safeJobs.filter((j) => !j.batchId || !activeBatches.some((b) => b.id === j.batchId));

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Upload Files
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Stage local files with resumable multipart uploads, or bulk transfer multiple remote URLs directly to Google Drive.
        </p>
      </div>

      {/* Upload creation form */}
      <div className="relative z-20">
        <UploadForm onJobCreated={fetchData} />
      </div>

      {/* Active Batches Section */}
      {batches.length > 0 && (
        <div className="space-y-3 relative z-10">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
            Batch Import Tasks ({batches.length})
          </h3>
          <div className="space-y-4">
            {batches.map((batch) => (
              <BatchProgress key={batch.id} batch={batch} onRefresh={fetchData} />
            ))}
          </div>
        </div>
      )}

      {/* Uploads and History List */}
      <div className="relative z-0">
        <JobList jobs={standaloneJobs} onRefresh={fetchData} />
      </div>
    </div>
  );
}
