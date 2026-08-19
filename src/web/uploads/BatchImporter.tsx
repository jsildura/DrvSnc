import React, { useState, useRef, useMemo } from 'react';
import { parseBatchText, parseBatchFile } from './batchParser';
import { createBatchUpload } from '../api/jobs';
import { FolderPicker } from '../components/FolderPicker';
import { BatchView } from '../../shared/contracts';
import { redactSourceUrl } from '../../worker/services/remoteUrlPolicy';

interface BatchImporterProps {
  onBatchCreated: (batch: BatchView) => void;
}

interface BatchRowItem {
  key: string;
  url: string;
  displayUrl: string;
  filename?: string;
}

export function BatchImporter({ onBatchCreated }: BatchImporterProps) {
  const [rawText, setRawText] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(undefined);
  const [selectedFolderName, setSelectedFolderName] = useState('My Drive (Root)');
  const [customFilenames, setCustomFilenames] = useState<Record<string, string>>({});
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse whenever rawText changes
  const parseResult = useMemo(() => {
    return parseBatchText(rawText);
  }, [rawText]);

  // Create stable row items keyed by index + url
  const activeItems: BatchRowItem[] = useMemo(() => {
    return parseResult.items
      .map((item, idx) => {
        const key = `${idx}-${item.url}`;
        return {
          key,
          url: item.url,
          displayUrl: redactSourceUrl(item.url),
          filename: customFilenames[key] !== undefined ? customFilenames[key] : item.filename,
        };
      })
      .filter((item) => !removedKeys.has(item.key));
  }, [parseResult.items, removedKeys, customFilenames]);

  const handleFileUpload = async (file: File) => {
    setSubmitError(null);
    const res = await parseBatchFile(file);
    if (res.error && res.items.length === 0) {
      setSubmitError(res.error);
      return;
    }
    // Set raw text directly so parser shows all invalid & duplicate warnings
    setRawText(res.rawText || '');
    setRemovedKeys(new Set());
    setCustomFilenames({});
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => {
    setDragActive(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleRemoveItem = (key: string) => {
    setRemovedKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (activeItems.length === 0 || isSubmitting) return;

    if (activeItems.length > 50) {
      setSubmitError('Batch exceeds 50 URLs. Please remove items before submitting.');
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitError(null);

      const payload = {
        items: activeItems.map((item) => ({
          url: item.url,
          filename: item.filename?.trim() || undefined,
        })),
        folderId: selectedFolderId,
      };

      const res = await createBatchUpload(payload);
      setRawText('');
      setCustomFilenames({});
      setRemovedKeys(new Set());
      onBatchCreated(res.batch);
    } catch (err) {
      setSubmitError((err as Error).message || 'Failed to start batch upload');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Drag & Drop File Zone / Textarea Tabs */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative rounded-3xl border-2 border-dashed transition-all p-4 ${
          dragActive
            ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30'
            : 'border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40'
        }`}
      >
        <div className="flex items-center justify-between mb-2 px-1 gap-2 flex-wrap sm:flex-nowrap">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
            Paste Download URLs (1 per line, up to 50)
          </label>

          {/* Quick .txt file upload button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 sm:gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium shrink-0 whitespace-nowrap px-2 py-1 sm:px-0 sm:py-0 rounded-lg bg-indigo-50/80 sm:bg-transparent dark:bg-indigo-950/50 sm:dark:bg-transparent border border-indigo-200/50 sm:border-0 dark:border-indigo-900/50 transition-colors"
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span className="hidden min-[414px]:inline">Upload .txt file</span>
            <span className="inline min-[414px]:hidden">.txt file</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileUpload(e.target.files[0]);
              }
            }}
          />
        </div>

        <textarea
          rows={5}
          value={rawText}
          onChange={(e) => {
            setRawText(e.target.value);
            setRemovedKeys(new Set());
            setCustomFilenames({});
          }}
          placeholder="https://example.com/video1.mp4&#10;https://example.com/dataset.zip&#10;https://example.com/audio.mp3"
          className="w-full font-mono text-xs p-3 rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
        />

        <div className="flex flex-wrap items-center justify-between gap-2 mt-2 px-1 text-[11px] text-slate-400">
          <span>Or drag & drop any .txt link list directly into this box</span>
          <span className="font-semibold text-indigo-600 dark:text-indigo-400">
            {activeItems.length} / 50 valid URLs
          </span>
        </div>
      </div>

      {/* Parse Warnings & Feedback */}
      {parseResult.invalidLines.length > 0 && (
        <div className="p-3 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-600 dark:text-rose-400 space-y-1">
          <p className="font-semibold">⚠️ {parseResult.invalidLines.length} invalid line(s) skipped:</p>
          <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
            {parseResult.invalidLines.slice(0, 3).map((inv, idx) => (
              <li key={idx}>
                Line {inv.line}: {inv.reason}
              </li>
            ))}
            {parseResult.invalidLines.length > 3 && (
              <li>...and {parseResult.invalidLines.length - 3} more</li>
            )}
          </ul>
        </div>
      )}

      {parseResult.duplicateLines.length > 0 && (
        <div className="p-3 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-700 dark:text-amber-400">
          ℹ️ {parseResult.duplicateLines.length} duplicate URL(s) automatically de-duplicated.
        </div>
      )}

      {/* Destination Folder Selector */}
      <FolderPicker
        selectedFolderId={selectedFolderId}
        selectedFolderName={selectedFolderName}
        onSelect={(folderId, folderName) => {
          setSelectedFolderId(folderId);
          setSelectedFolderName(folderName);
        }}
      />

      {/* Items Preview Table / List */}
      {activeItems.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
            <span className="font-semibold">Batch Items Queue ({activeItems.length})</span>
            <span>All items will upload in parallel to Google Drive</span>
          </div>

          <div className="max-h-56 overflow-y-auto space-y-1.5 p-2 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/40 dark:bg-slate-900/40 divide-y divide-slate-100 dark:divide-slate-800/60">
            {activeItems.map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between gap-3 pt-1.5 first:pt-0 text-xs text-slate-700 dark:text-slate-300"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {item.displayUrl}
                  </p>
                  <input
                    type="text"
                    value={item.filename || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCustomFilenames((prev) => ({ ...prev, [item.key]: val }));
                    }}
                    placeholder="Custom filename (optional)"
                    className="mt-0.5 w-full text-xs font-semibold bg-transparent border-b border-dashed border-slate-300 dark:border-slate-700 focus:outline-none focus:border-indigo-500 text-slate-800 dark:text-white"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => handleRemoveItem(item.key)}
                  title="Remove from batch"
                  className="p-1 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {submitError && (
        <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-600 dark:text-rose-400">
          {submitError}
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={activeItems.length === 0 || isSubmitting || activeItems.length > 50}
        className="w-full py-3 px-6 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-md shadow-indigo-500/20 hover:shadow-indigo-500/30 transition-all active:scale-[0.99] flex items-center justify-center gap-2"
      >
        {isSubmitting ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            <span>Starting Parallel Batch ({activeItems.length} files)...</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>Import & Start Batch Transfer ({activeItems.length} URLs)</span>
          </>
        )}
      </button>
    </form>
  );
}
