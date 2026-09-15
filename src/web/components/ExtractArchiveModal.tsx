import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { DriveItemView } from '../../shared/contracts';
import { initExtraction, uploadExtractedToDrive, createFolder } from '../api/drive';
import { ExtractMeClient, ExtractMeTreeNode, ExtractedFileItem } from '../services/extractMeClient';
import { getArchiveFolderName } from '../../shared/archiveUtils';
import { FolderPicker } from './FolderPicker';

interface ExtractArchiveModalProps {
  isOpen: boolean;
  item: DriveItemView | null;
  currentFolderId?: string;
  onClose: () => void;
  onComplete: () => void;
}

type ModalState =
  | 'init'
  | 'uploading'
  | 'extracting'
  | 'password_prompt'
  | 'tree_view'
  | 'saving'
  | 'complete'
  | 'error';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function ExtractArchiveModal({
  isOpen,
  item,
  currentFolderId,
  onClose,
  onComplete,
}: ExtractArchiveModalProps) {
  const [modalState, setModalState] = useState<ModalState>('init');
  const [progress, setProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Extracted data
  const [treeData, setTreeData] = useState<ExtractMeTreeNode[]>([]);
  const [tmpFilename, setTmpFilename] = useState<string>('');
  const [archiveFilename, setArchiveFilename] = useState<string>('');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Destination folder settings
  const [targetFolderId, setTargetFolderId] = useState<string | undefined>(currentFolderId);
  const [targetFolderName, setTargetFolderName] = useState<string>('Current Folder');
  const [createSubfolder, setCreateSubfolder] = useState<boolean>(true);
  const [subfolderName, setSubfolderName] = useState<string>('');

  // Saving progress
  const [saveStatus, setSaveStatus] = useState<string>('');
  const [saveProgress, setSaveProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [isGeneratingZip, setIsGeneratingZip] = useState<boolean>(false);

  // Client references
  const clientRef = useRef<ExtractMeClient | null>(null);
  const activeTaskCancelRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (activeTaskCancelRef.current) {
        activeTaskCancelRef.current();
      }
    };
  }, []);

  // Initialize or reset when modal opens
  useEffect(() => {
    if (!isOpen || !item) {
      setModalState('init');
      setProgress(0);
      setErrorMessage('');
      setPasswordInput('');
      setPasswordError(null);
      setTreeData([]);
      setSelectedPaths(new Set());
      setExpandedFolders({});
      if (activeTaskCancelRef.current) {
        activeTaskCancelRef.current();
        activeTaskCancelRef.current = null;
      }
      return;
    }

    setTargetFolderId(currentFolderId);
    setTargetFolderName(currentFolderId ? 'Current Folder' : 'My Drive (Root)');
    const defaultFolderName = getArchiveFolderName(item.name);
    setSubfolderName(defaultFolderName);

    if (activeTaskCancelRef.current) {
      activeTaskCancelRef.current();
      activeTaskCancelRef.current = null;
    }

    startExtractionProcess();

    return () => {
      if (activeTaskCancelRef.current) {
        activeTaskCancelRef.current();
        activeTaskCancelRef.current = null;
      }
    };
  }, [isOpen, item]);

  const startExtractionProcess = useCallback(async () => {
    if (!item) return;

    const abortController = new AbortController();
    activeTaskCancelRef.current = () => abortController.abort();

    try {
      setModalState('init');
      setProgress(0);
      setErrorMessage('');
      setPasswordError(null);

      // 1. Initialize with worker to fetch fresh token & host
      const initData = await initExtraction(item.id);

      if (!isMountedRef.current || abortController.signal.aborted) return;

      const client = new ExtractMeClient(initData.extractMeHost);
      clientRef.current = client;

      // 2. Instruct extract.me to download from Google Drive
      setModalState('uploading');
      const task = client.openFromDrive({
        fileId: initData.fileId,
        accessToken: initData.accessToken,
        fileName: initData.fileName,
        fileSize: initData.fileSize,
        streamUrl: initData.streamUrl,
        signal: abortController.signal,
        onProgress: (pct) => {
          if (isMountedRef.current && !abortController.signal.aborted) {
            setProgress(pct);
          }
        },
      });

      activeTaskCancelRef.current = () => {
        task.cancel();
        abortController.abort();
      };
      const remoteResult = await task.promise;

      if (!isMountedRef.current || abortController.signal.aborted) return;

      setTmpFilename(remoteResult.tmp_filename);
      setArchiveFilename(remoteResult.archive_filename);

      // 3. Unpack archive
      await executeUnpack(client, remoteResult.tmp_filename, remoteResult.archive_filename);
    } catch (err) {
      if (!isMountedRef.current) return;
      setErrorMessage((err as Error).message || 'Failed to start archive extraction');
      setModalState('error');
    }
  }, [item]);

  const executeUnpack = async (
    client: ExtractMeClient,
    tmpFile: string,
    archiveName: string,
    password?: string
  ) => {
    setModalState('extracting');

    try {
      const unpackResult = await client.unpack({
        tmp_filename: tmpFile,
        archive_filename: archiveName,
        password,
      });

      if (!isMountedRef.current) return;

      if (unpackResult.error) {
        if (unpackResult.error_type === 'wrong_password' || unpackResult.error === 'wrong_password') {
          setPasswordError(password ? 'Incorrect password, please try again.' : null);
          setModalState('password_prompt');
          return;
        }

        if (unpackResult.message_type === 'daily_jobs_exceeded') {
          setErrorMessage('Daily extraction quota exceeded. Please try again later.');
          setModalState('error');
          return;
        }

        const errText =
          typeof unpackResult.error === 'string'
            ? unpackResult.error
            : (unpackResult as any).error_title ||
              (unpackResult as any).error_desc ||
              'Failed to extract archive contents';
        setErrorMessage(errText);
        setModalState('error');
        return;
      }

      setTreeData(unpackResult.tree_data);

      // Auto-select all file paths
      const flattened = client.flattenTree(unpackResult.tree_data);
      const allFilePaths = new Set<string>();
      const initialExpanded: Record<string, boolean> = {};

      flattened.forEach((file) => {
        if (!file.isFolder) {
          allFilePaths.add(file.fullPath);
        } else {
          initialExpanded[file.fullPath] = true;
        }
      });

      setSelectedPaths(allFilePaths);
      setExpandedFolders(initialExpanded);
      setModalState('tree_view');
    } catch (err) {
      if (!isMountedRef.current) return;
      setErrorMessage((err as Error).message || 'Failed to extract archive contents');
      setModalState('error');
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput.trim() || !clientRef.current) return;
    executeUnpack(clientRef.current, tmpFilename, archiveFilename, passwordInput);
  };

  // Flattened tree items memoized
  const flattenedFiles = useMemo(() => {
    if (!clientRef.current || treeData.length === 0) return [];
    return clientRef.current.flattenTree(treeData);
  }, [treeData]);

  const nonFolderFiles = useMemo(() => {
    return flattenedFiles.filter((f) => !f.isFolder);
  }, [flattenedFiles]);

  const totalSelectedSize = useMemo(() => {
    let size = 0;
    nonFolderFiles.forEach((file) => {
      if (selectedPaths.has(file.fullPath) && file.size) {
        size += file.size;
      }
    });
    return size;
  }, [nonFolderFiles, selectedPaths]);

  const isAllSelected = nonFolderFiles.length > 0 && selectedPaths.size === nonFolderFiles.length;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedPaths(new Set());
    } else {
      const all = new Set<string>();
      nonFolderFiles.forEach((f) => all.add(f.fullPath));
      setSelectedPaths(all);
    }
  };

  const handleToggleFileSelection = (fullPath: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) {
        next.delete(fullPath);
      } else {
        next.add(fullPath);
      }
      return next;
    });
  };

  const handleToggleFolderExpand = (folderPath: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderPath]: !prev[folderPath],
    }));
  };

  // Save extracted files directly into Google Drive
  const handleSaveToDrive = async () => {
    if (!clientRef.current || !tmpFilename) return;

    setModalState('saving');
    setSaveStatus('Preparing destination folder...');

    try {
      let finalFolderId = targetFolderId;

      // If user wants a new subfolder created for the archive
      if (createSubfolder && subfolderName.trim()) {
        setSaveStatus(`Creating folder "${subfolderName.trim()}"...`);
        const folderRes = await createFolder(subfolderName.trim(), targetFolderId);
        finalFolderId = folderRes.id;
      }

      const selectedFiles = nonFolderFiles.filter((f) => selectedPaths.has(f.fullPath));

      if (selectedFiles.length === 0) {
        setErrorMessage('No files selected for extraction.');
        setModalState('error');
        return;
      }

      setSaveProgress({ current: 0, total: selectedFiles.length });

      // Cache of created subfolders: relativeDirPath -> googleFolderId
      const folderCache = new Map<string, string>();
      folderCache.set('', finalFolderId || '');

      const getOrCreateDestinationFolder = async (dirSegments: string[]): Promise<string | undefined> => {
        if (dirSegments.length === 0) return finalFolderId;

        let currentRelative = '';
        let currentParentId = finalFolderId;

        for (const segment of dirSegments) {
          const nextRelative = currentRelative ? `${currentRelative}/${segment}` : segment;
          if (folderCache.has(nextRelative)) {
            currentParentId = folderCache.get(nextRelative);
          } else {
            setSaveStatus(`Creating folder "${segment}"...`);
            const created = await createFolder(segment, currentParentId);
            folderCache.set(nextRelative, created.id);
            currentParentId = created.id;
          }
          currentRelative = nextRelative;
        }

        return currentParentId;
      };

      // Upload each selected file to its corresponding Google Drive folder
      let count = 0;
      for (const file of selectedFiles) {
        count++;
        setSaveProgress({ current: count, total: selectedFiles.length });
        setSaveStatus(`Uploading file ${count} of ${selectedFiles.length}: ${file.name}`);

        const dirParts = file.path.slice(0, -1);
        const folderForFile = await getOrCreateDestinationFolder(dirParts);

        const { directUrl } = clientRef.current.getFileDownloadUrl(tmpFilename, file.path, file.name);

        await uploadExtractedToDrive(directUrl, file.name, folderForFile);
      }

      setModalState('complete');
    } catch (err) {
      if (!isMountedRef.current) return;
      setErrorMessage((err as Error).message || 'Failed to save extracted files to Google Drive');
      setModalState('error');
    }
  };

  // Download entire extracted archive as ZIP to user's computer
  const handleDownloadZip = async () => {
    if (!clientRef.current || !tmpFilename || isGeneratingZip) return;
    setIsGeneratingZip(true);
    try {
      const { proxiedUrl } = await clientRef.current.requestZipDownload(
        tmpFilename,
        archiveFilename || item?.name || 'archive'
      );
      window.open(proxiedUrl, '_blank');
    } catch (err) {
      alert((err as Error).message || 'Failed to generate ZIP archive');
    } finally {
      if (isMountedRef.current) {
        setIsGeneratingZip(false);
      }
    }
  };

  // Download single file to user's computer
  const handleDownloadSingleFile = (file: ExtractedFileItem) => {
    if (!clientRef.current || !tmpFilename) return;
    const { proxiedUrl } = clientRef.current.getFileDownloadUrl(tmpFilename, file.path, file.name);
    window.open(proxiedUrl, '_blank');
  };

  if (!isOpen || !item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div
        className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100 truncate">
                Extract Archive
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate" title={item.name}>
                {item.name}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Initializing / Uploading Stage */}
          {(modalState === 'init' || modalState === 'uploading') && (
            <div className="py-12 flex flex-col items-center text-center space-y-4">
              <div className="relative w-16 h-16 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-4 border-amber-500/20 border-t-amber-500 animate-spin" />
                <svg className="w-7 h-7 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                </svg>
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {modalState === 'init' ? 'Connecting to extraction engine...' : 'Fetching archive from Google Drive...'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {progress > 0 ? `${progress}% completed` : 'Establishing secure stream...'}
                </p>
              </div>

              {progress > 0 && (
                <div className="w-64 bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Extracting Stage */}
          {modalState === 'extracting' && (
            <div className="py-12 flex flex-col items-center text-center space-y-4">
              <div className="relative w-16 h-16 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20 border-t-indigo-500 animate-spin" />
                <svg className="w-7 h-7 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Decompressing archive...
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Analyzing archive structure and unpacking files...
                </p>
              </div>
            </div>
          )}

          {/* Password Prompt */}
          {modalState === 'password_prompt' && (
            <form onSubmit={handlePasswordSubmit} className="py-6 max-w-md mx-auto space-y-4">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>

              <div className="text-center space-y-1">
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
                  Archive is Password Protected
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Please enter the decryption password to view and extract its contents.
                </p>
              </div>

              {passwordError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-600 dark:text-rose-400 text-center">
                  {passwordError}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Password</label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Enter archive password"
                  autoFocus
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!passwordInput.trim()}
                  className="flex-1 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-amber-500/20"
                >
                  Unlock & Extract
                </button>
              </div>
            </form>
          )}

          {/* Tree View (Main Interactive State) */}
          {modalState === 'tree_view' && (
            <div className="space-y-4">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleToggleSelectAll}
                    className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 px-2 py-1 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors"
                  >
                    {isAllSelected ? 'Deselect All' : 'Select All'}
                  </button>
                  <span className="text-slate-300 dark:text-slate-700">•</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {selectedPaths.size} of {nonFolderFiles.length} files selected ({formatBytes(totalSelectedSize)})
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadZip}
                  disabled={isGeneratingZip}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
                  title="Download all files as a ZIP directly to your computer"
                >
                  {isGeneratingZip ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                      <span>Preparing ZIP...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span>Download ZIP</span>
                    </>
                  )}
                </button>
              </div>

              {/* File Tree List */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800/80 max-h-60 overflow-y-auto bg-slate-50/50 dark:bg-slate-900/30">
                {flattenedFiles.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    Archive appears to be empty.
                  </div>
                ) : (
                  flattenedFiles.map((file) => {
                    const depth = file.path.length - 1;
                    const isSelected = selectedPaths.has(file.fullPath);

                    if (file.isFolder) {
                      const isExpanded = expandedFolders[file.fullPath] ?? true;
                      return (
                        <div
                          key={file.id}
                          style={{ paddingLeft: `${Math.max(12, depth * 16 + 12)}px` }}
                          onClick={() => handleToggleFolderExpand(file.fullPath)}
                          className="flex items-center justify-between py-2 pr-3 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 cursor-pointer select-none group transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition-colors">
                              {isExpanded ? (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                </svg>
                              ) : (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                              )}
                            </span>
                            <svg className="w-4 h-4 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                            </svg>
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                              {file.name}
                            </span>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={file.id}
                        style={{ paddingLeft: `${Math.max(12, depth * 16 + 28)}px` }}
                        onClick={() => handleToggleFileSelection(file.fullPath)}
                        className={`flex items-center justify-between py-1.5 pr-3 cursor-pointer select-none group transition-colors ${
                          isSelected ? 'bg-amber-50/60 dark:bg-amber-950/20' : 'hover:bg-slate-100/60 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="w-3.5 h-3.5 rounded text-amber-500 focus:ring-amber-500/30 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-pointer"
                          />
                          <svg className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span className="text-xs text-slate-700 dark:text-slate-300 truncate" title={file.fullPath}>
                            {file.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-[11px] text-slate-400 font-mono">
                            {formatBytes(file.size)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadSingleFile(file);
                            }}
                            title="Download this file"
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-all"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Destination Folder Configuration */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 rounded-xl space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <label className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Destination Folder in Google Drive
                    </label>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Choose where extracted files should be saved
                    </p>
                  </div>

                  <div className="w-full sm:w-56">
                    <FolderPicker
                      selectedFolderId={targetFolderId}
                      selectedFolderName={targetFolderName}
                      onSelect={(id, name) => {
                        setTargetFolderId(id);
                        setTargetFolderName(name);
                      }}
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={createSubfolder}
                      onChange={(e) => setCreateSubfolder(e.target.checked)}
                      className="w-3.5 h-3.5 rounded text-amber-500 focus:ring-amber-500/30 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                    <span className="text-xs text-slate-700 dark:text-slate-300">
                      Extract into a new subfolder
                    </span>
                  </label>

                  {createSubfolder && (
                    <input
                      type="text"
                      value={subfolderName}
                      onChange={(e) => setSubfolderName(e.target.value)}
                      placeholder="Folder name"
                      className="px-2.5 py-1 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/30 w-44"
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Saving / Uploading to Drive Stage */}
          {modalState === 'saving' && (
            <div className="py-12 flex flex-col items-center text-center space-y-4">
              <div className="relative w-16 h-16 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin" />
                <svg className="w-7 h-7 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Saving to Google Drive...
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {saveStatus}
                </p>
              </div>

              {saveProgress.total > 0 && (
                <div className="w-64 bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${Math.round((saveProgress.current / saveProgress.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Complete Stage */}
          {modalState === 'complete' && (
            <div className="py-8 flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-500 flex items-center justify-center animate-bounce-short">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  Extraction Complete!
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                  Extracted files have been successfully uploaded to your Google Drive.
                </p>
              </div>

              <div className="pt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    onComplete();
                    onClose();
                  }}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-emerald-600/20"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Error Stage */}
          {modalState === 'error' && (
            <div className="py-8 flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-rose-500/10 dark:bg-rose-500/20 text-rose-500 flex items-center justify-center">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>

              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  Extraction Failed
                </h3>
                <p className="text-xs text-rose-600 dark:text-rose-400">
                  {errorMessage || 'An unexpected error occurred during extraction.'}
                </p>
              </div>

              <div className="pt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={startExtractionProcess}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-amber-500/20"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions (Only in Tree View) */}
        {modalState === 'tree_view' && (
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSaveToDrive}
              disabled={selectedPaths.size === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-amber-500/20"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span>Save to Google Drive ({selectedPaths.size})</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
