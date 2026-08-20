// Drives browser-relayed transfers: source fetch → R2 staging → hand off to the transfer workflow.
//
// Owned by UploaderPage rather than either child, because both the upload form and the job list can
// start a relay — the form for a new URL, the job list for one the worker was refused.
//
// While a relay is running the tab *is* the transfer. Closing it stops the download, so there is a
// `beforeunload` guard, and any failure cancels the job so the half-written multipart upload in R2 is
// abandoned instead of billed.

import { useState, useRef, useCallback, useEffect } from 'react';
import { createRelayUploadJob, getSignPartUrls, completeLocalUploadJob, cancelJob } from '../api/jobs';
import { validateRemoteUrl } from '../../worker/services/remoteUrlPolicy';
import { fetchSourceInBrowser } from './relayFetch';
import { uploadStreamMultipart } from './multipartUpload';
import { rememberRelaySource, pruneRelaySources } from './relayUrlCache';

export interface StartRelayOptions {
  filename?: string;
  folderId?: string;
  /** Per-call progress, for a caller rendering its own bar. `totalBytes` is 0 until the end. */
  onProgress?: (stagedBytes: number, totalBytes: number) => void;
}

export interface RelayProgress {
  stagedBytes: number;
  totalBytes: number;
}

export interface BrowserRelay {
  /** Staging progress of in-flight relays, keyed by job id, for rows the job list already renders. */
  relayProgress: Record<string, RelayProgress>;
  isRelaying: boolean;
  startRelay: (url: string, options?: StartRelayOptions) => Promise<void>;
  cancelRelay: (jobId: string) => void;
}

export function useBrowserRelay(onJobChanged: () => void): BrowserRelay {
  const [relayProgress, setRelayProgress] = useState<Record<string, RelayProgress>>({});
  const [activeCount, setActiveCount] = useState(0);
  const controllers = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    pruneRelaySources();
  }, []);

  // The bytes only exist in this tab, so a reload loses them. Browsers ignore the message text and
  // show their own wording, but the prompt itself is what matters.
  useEffect(() => {
    if (activeCount === 0) return;

    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'A browser transfer is still running. Leaving this page will cancel it.';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [activeCount]);

  const clearProgress = useCallback((jobId: string) => {
    setRelayProgress((prev) => {
      if (!(jobId in prev)) return prev;
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
  }, []);

  const startRelay = useCallback(
    async (url: string, options: StartRelayOptions = {}): Promise<void> => {
      const validation = validateRemoteUrl(url.trim());
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid remote URL');
      }
      const sourceUrl = validation.normalizedUrl!;

      const controller = new AbortController();
      let jobId: string | null = null;
      setActiveCount((n) => n + 1);

      try {
        // Read the source before creating anything server-side: a host that refuses the fetch
        // should not leave a job and an open multipart upload behind.
        const source = await fetchSourceInBrowser(sourceUrl, controller.signal);

        let session;
        try {
          session = await createRelayUploadJob({
            url: sourceUrl,
            fileSize: source.size,
            filename: options.filename,
            folderId: options.folderId,
            mimeType: source.contentType || undefined,
          });
        } catch (err) {
          // The source is already streaming by this point. Without this the open connection — and
          // whatever the browser has buffered of a multi-gigabyte body — outlives the failure, and
          // the `catch` below cannot reach it because there is no job id to key off yet.
          await source.stream.cancel().catch(() => undefined);
          throw err;
        }

        jobId = session.job.id;
        controllers.current.set(jobId, controller);
        rememberRelaySource(jobId, sourceUrl);
        setRelayProgress((prev) => ({
          ...prev,
          [jobId!]: { stagedBytes: 0, totalBytes: source.size },
        }));
        onJobChanged();

        const { parts, totalBytes } = await uploadStreamMultipart(source.stream, {
          partSize: session.partSize,
          contentType: session.job.mimeType,
          expectedTotalBytes: source.size,
          signal: controller.signal,
          getPartUrls: (from, count) =>
            getSignPartUrls(jobId!, from, count).then((r) => r.parts),
          onProgress: (staged, total) => {
            setRelayProgress((prev) => ({ ...prev, [jobId!]: { stagedBytes: staged, totalBytes: total } }));
            options.onProgress?.(staged, total);
          },
        });

        await completeLocalUploadJob(jobId, parts, totalBytes);
        clearProgress(jobId);
        onJobChanged();
      } catch (err) {
        if (jobId) {
          // Releases the staged parts; without this the abandoned multipart upload keeps accruing
          // storage until R2's own lifecycle rules catch it.
          await cancelJob(jobId).catch(() => undefined);
          clearProgress(jobId);
          onJobChanged();
        }
        throw err;
      } finally {
        if (jobId) controllers.current.delete(jobId);
        setActiveCount((n) => Math.max(0, n - 1));
      }
    },
    [onJobChanged, clearProgress]
  );

  const cancelRelay = useCallback((jobId: string) => {
    controllers.current.get(jobId)?.abort();
  }, []);

  return { relayProgress, isRelaying: activeCount > 0, startRelay, cancelRelay };
}
