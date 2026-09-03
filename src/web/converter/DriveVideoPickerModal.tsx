import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { listDriveItems, searchDriveItems } from '../api/drive';
import { DriveItemView } from '../../shared/contracts';
import { SelectedDriveFile } from './types';

interface DriveVideoPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (file: SelectedDriveFile) => void;
}

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mkv',
  'avi',
  'mov',
  'wmv',
  'flv',
  'webm',
  'm4v',
  '3gp',
  'ts',
  'mts',
  'm2ts',
  'vob',
  'ogv',
  'mpg',
  'mpeg',
]);

function isVideoItem(item: DriveItemView): boolean {
  if (item.isFolder) return false;
  if (item.mimeType && (item.mimeType.startsWith('video/') || item.mimeType === 'application/vnd.google-apps.video')) {
    return true;
  }
  const ext = item.name.split('.').pop()?.toLowerCase();
  return Boolean(ext && VIDEO_EXTENSIONS.has(ext));
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function DriveVideoPickerModal({ isOpen, onClose, onSelect }: DriveVideoPickerModalProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id?: string; name: string }[]>([
    { id: undefined, name: 'My Drive' },
  ]);
  const [items, setItems] = useState<DriveItemView[]>([]);
  const [searchResults, setSearchResults] = useState<DriveItemView[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<DriveItemView | null>(null);

  // Debounce search query so typing is smooth
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load folder contents when browsing folders
  const loadFolderContents = useCallback(async (folderId?: string) => {
    try {
      setIsLoading(true);
      const res = await listDriveItems({
        parentId: folderId,
        pageSize: 100,
        orderBy: 'folder,name',
      });
      setItems(res.items || []);
    } catch {
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // When browsing without search, load folder
  useEffect(() => {
    if (isOpen && !debouncedQuery) {
      loadFolderContents(currentFolderId);
    }
  }, [isOpen, currentFolderId, debouncedQuery, loadFolderContents]);

  // When search query is active, query Google Drive globally across all folders!
  useEffect(() => {
    if (!isOpen || !debouncedQuery) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let active = true;
    setIsSearching(true);

    searchDriveItems(debouncedQuery, { pageSize: 100 })
      .then((res) => {
        if (active) {
          setSearchResults(res.items || []);
          setIsSearching(false);
        }
      })
      .catch(() => {
        if (active) {
          setSearchResults([]);
          setIsSearching(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isOpen, debouncedQuery]);

  const handleOpenFolder = (folder: DriveItemView) => {
    setCurrentFolderId(folder.id);
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setSelectedItem(null);
  };

  const handleBreadcrumbClick = (crumb: { id?: string; name: string }, idx: number) => {
    setBreadcrumbs((prev) => prev.slice(0, idx + 1));
    setCurrentFolderId(crumb.id);
    setSelectedItem(null);
  };

  const isSearchActive = Boolean(debouncedQuery);
  const displayItems = isSearchActive ? searchResults : items;

  const folders = useMemo(
    () => (isSearchActive ? [] : displayItems.filter((i) => i.isFolder)),
    [isSearchActive, displayItems]
  );
  const videoFiles = useMemo(
    () => displayItems.filter((i) => isVideoItem(i)),
    [displayItems]
  );

  const handleConfirm = () => {
    if (selectedItem) {
      onSelect({
        id: selectedItem.id,
        name: selectedItem.name,
        sizeBytes: selectedItem.size || 0,
        mimeType: selectedItem.mimeType,
        parentFolderId: selectedItem.parents?.[0] || currentFolderId,
      });
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Select Video from Google Drive
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Browse your Drive folders and pick a video file to convert
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search & Breadcrumbs Bar */}
        <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-2.5">
          {/* Search box */}
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search all videos in Google Drive (e.g. .mp4, mkv, title)..."
              className="w-full pl-9 pr-8 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded-full hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors"
                title="Clear search"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>

          {/* Breadcrumbs Navigation or Global Search Indicator */}
          {isSearchActive ? (
            <div className="flex items-center justify-between text-xs py-0.5 px-0.5">
              <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                <span className="font-semibold text-indigo-600 dark:text-indigo-400">Search Results:</span>
                <span className="text-slate-500 dark:text-slate-400 truncate max-w-[280px]">
                  across Google Drive for &ldquo;{debouncedQuery}&rdquo;
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
              >
                Back to Folders
              </button>
            </div>
          ) : (
            <nav className="flex items-center gap-1.5 overflow-x-auto text-xs text-slate-600 dark:text-slate-300 py-0.5">
              {breadcrumbs.map((crumb, idx) => {
                const isLast = idx === breadcrumbs.length - 1;
                return (
                  <React.Fragment key={crumb.id || 'root'}>
                    {idx > 0 && <span className="text-slate-400 dark:text-slate-500">/</span>}
                    <button
                      type="button"
                      onClick={() => handleBreadcrumbClick(crumb, idx)}
                      className={`whitespace-nowrap px-1.5 py-0.5 rounded hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors ${
                        isLast
                          ? 'font-semibold text-slate-900 dark:text-white'
                          : 'text-indigo-600 dark:text-indigo-400'
                      }`}
                    >
                      {crumb.name}
                    </button>
                  </React.Fragment>
                );
              })}
            </nav>
          )}
        </div>

        {/* File & Folder List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[250px]">
          {isLoading || isSearching ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400">
              <svg className="w-8 h-8 animate-spin text-indigo-600 mb-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span className="text-xs">
                {isSearchActive ? 'Searching all Google Drive folders...' : 'Loading Drive contents...'}
              </span>
            </div>
          ) : folders.length === 0 && videoFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400 dark:text-slate-500">
              <svg className="w-10 h-10 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span className="text-sm font-medium">
                {isSearchActive ? `No videos matching "${debouncedQuery}" found` : 'No video files found in this folder'}
              </span>
              <span className="text-xs mt-0.5">
                {isSearchActive
                  ? 'Try searching with another keyword or file extension'
                  : 'Try navigating into subfolders or searching across your Drive'}
              </span>
            </div>
          ) : (
            <>
              {/* Folders List */}
              {folders.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5 px-1">
                    Folders ({folders.length})
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {folders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => handleOpenFolder(folder)}
                        className="flex items-center gap-2.5 p-2 rounded-xl text-left border border-slate-200/70 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:border-slate-300 dark:hover:border-slate-700 transition-all text-xs"
                      >
                        <svg className="w-5 h-5 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                        </svg>
                        <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                          {folder.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Video Files List */}
              {videoFiles.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5 px-1">
                    {isSearchActive
                      ? `Search Results (${videoFiles.length} video${videoFiles.length === 1 ? '' : 's'})`
                      : `Video Files (${videoFiles.length})`}
                  </h4>
                  <div className="space-y-1.5">
                    {videoFiles.map((file) => {
                      const isSelected = selectedItem?.id === file.id;
                      const ext = file.name.split('.').pop()?.toUpperCase() || 'VIDEO';
                      return (
                        <div
                          key={file.id}
                          onClick={() => setSelectedItem(file)}
                          onDoubleClick={() => {
                            setSelectedItem(file);
                            onSelect({
                              id: file.id,
                              name: file.name,
                              sizeBytes: file.size || 0,
                              mimeType: file.mimeType,
                              parentFolderId: currentFolderId,
                            });
                            onClose();
                          }}
                          className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-500 text-indigo-950 dark:text-indigo-200 ring-2 ring-indigo-500/20'
                              : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                {file.name}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                <span className="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                                  {ext}
                                </span>
                                <span>{formatBytes(file.size || 0)}</span>
                              </div>
                            </div>
                          </div>
                          {isSelected && (
                            <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 sm:p-4 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[280px]">
            {selectedItem ? `Selected: ${selectedItem.name}` : 'Select a video to continue'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedItem}
              onClick={handleConfirm}
              className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Choose Video
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
