import React, { useState, useRef } from 'react';
import {
  createRemoteUploadJob,
  initiateLocalUploadJob,
  getSignPartUrls,
  completeLocalUploadJob,
} from '../api/jobs';
import { uploadFileMultipart } from './multipartUpload';
import { validateRemoteUrl } from '../../worker/services/remoteUrlPolicy';
import { FolderPicker } from '../components/FolderPicker';
import { BatchImporter } from './BatchImporter';

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GiB

export function UploadForm({ onJobCreated }: { onJobCreated: () => void }) {
  const [activeMode, setActiveMode] = useState<'local' | 'remote' | 'batch'>('local');

  // Local upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Remote upload state
  const [remoteUrl, setRemoteUrl] = useState('');
  const [customFilename, setCustomFilename] = useState('');
  const [remoteFolderId, setRemoteFolderId] = useState<string | undefined>(undefined);
  const [remoteFolderName, setRemoteFolderName] = useState('My Drive (Root)');
  const [isSubmittingRemote, setIsSubmittingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const handleFileChange = (file: File | null) => {
    setLocalError(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setLocalError('File size exceeds the 5 GiB maximum limit');
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  };

  const handleLocalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || isUploading) return;

    try {
      setIsUploading(true);
      setLocalError(null);
      setUploadProgress(0);

      const initRes = await initiateLocalUploadJob({
        filename: selectedFile.name,
        fileSize: selectedFile.size,
        mimeType: selectedFile.type || 'application/octet-stream',
      });

      const parts = await uploadFileMultipart(selectedFile, {
        partSize: initRes.partSize,
        partCount: initRes.partCount,
        getPartUrls: (from, count) => getSignPartUrls(initRes.job.id, from, count).then((r) => r.parts),
        onProgress: (loaded, total) => {
          setUploadProgress(Math.round((loaded / total) * 100));
        },
      });

      await completeLocalUploadJob(initRes.job.id, parts);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onJobCreated();
    } catch (err) {
      setLocalError((err as Error).message || 'Failed to complete local upload');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!remoteUrl.trim() || isSubmittingRemote) return;

    setRemoteError(null);
    const validation = validateRemoteUrl(remoteUrl.trim());
    if (!validation.valid) {
      setRemoteError(validation.error || 'Invalid remote URL');
      return;
    }

    try {
      setIsSubmittingRemote(true);
      await createRemoteUploadJob({
        url: remoteUrl.trim(),
        filename: customFilename.trim() || undefined,
        folderId: remoteFolderId || undefined,
      });

      setRemoteUrl('');
      setCustomFilename('');
      // The destination is deliberately left as-is: sending several files to the same
      // folder is the common case, and re-picking it every time would be busywork.
      onJobCreated();
    } catch (err) {
      setRemoteError((err as Error).message || 'Failed to submit remote upload');
    } finally {
      setIsSubmittingRemote(false);
    }
  };

  return (
    <div className="relative z-20 p-4 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl shadow-sm">
      {/* Mode Switcher */}
      <div className="flex items-center gap-1 sm:gap-2 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-2xl w-fit max-w-full overflow-x-auto flex-nowrap mb-6">
        <button
          type="button"
          onClick={() => setActiveMode('local')}
          className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap shrink-0 ${activeMode === 'local'
            ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <span>Local File</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMode('remote')}
          className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap shrink-0 ${activeMode === 'remote'
            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span>Remote URL</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMode('batch')}
          className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap shrink-0 ${activeMode === 'batch'
            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span>Batch URLs (Bulk)</span>
        </button>
      </div>

      {/* Local Upload Form */}
      {activeMode === 'local' && (
        <form onSubmit={handleLocalSubmit} className="space-y-4">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files[0]) handleFileChange(e.dataTransfer.files[0]);
            }}
            className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-400 rounded-2xl p-8 text-center cursor-pointer transition-all hover:bg-blue-50/20 dark:hover:bg-blue-950/20"
          >
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
              className="hidden"
            />
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            {selectedFile ? (
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {(selectedFile.size / (1024 * 1024)).toFixed(2)} MiB
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Click to select or drag & drop file
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Supports up to 5 GiB per upload
                </p>
              </div>
            )}
          </div>

          {localError && (
            <p className="text-xs text-rose-500 font-medium">{localError}</p>
          )}

          {isUploading && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Staging to R2...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-600 h-2 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={!selectedFile || isUploading}
            className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium shadow-md shadow-blue-500/20 transition-colors"
          >
            {isUploading ? 'Uploading...' : 'Upload to Google Drive'}
          </button>
        </form>
      )}

      {/* Remote URL Form */}
      {activeMode === 'remote' && (
        <form onSubmit={handleRemoteSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Download URL
            </label>
            <input
              type="url"
              placeholder="https://example.com/archive.zip"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              required
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-800/50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Custom Filename (optional)
            </label>
            <input
              type="text"
              placeholder="my-archive.zip"
              value={customFilename}
              onChange={(e) => setCustomFilename(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-800/50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {remoteError && (
            <p className="text-xs text-rose-500 font-medium">{remoteError}</p>
          )}

          {/* Destination Folder Selector */}
          <FolderPicker
            selectedFolderId={remoteFolderId}
            selectedFolderName={remoteFolderName}
            onSelect={(folderId, folderName) => {
              setRemoteFolderId(folderId);
              setRemoteFolderName(folderName);
            }}
          />

          <button
            type="submit"
            disabled={!remoteUrl.trim() || isSubmittingRemote}
            className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium shadow-md shadow-indigo-500/20 transition-colors"
          >
            {isSubmittingRemote ? 'Starting Transfer...' : 'Start Remote Transfer'}
          </button>
        </form>
      )}

      {/* Batch Importer Form */}
      {activeMode === 'batch' && (
        <BatchImporter onBatchCreated={() => onJobCreated()} />
      )}
    </div>
  );
}
