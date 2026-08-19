import React, { useState, useEffect, useCallback } from 'react';
import { DriveItemView, QuotaView } from '../../shared/contracts';
import {
  listDriveItems,
  listSharedItems,
  listTrashItems,
  getDriveStorage,
  createFolder,
  renameItem,
  trashItem,
  restoreItem,
  deleteItemPermanently,
  emptyTrash,
  getDownloadUrl,
} from '../api/drive';
import FilePreview from '../../components/FilePreview';


type DriveViewSection = 'files' | 'shared' | 'trash';
type ViewMode = 'list' | 'grid';

function getFileExtension(name: string): string {
  const parts = name.split('.');
  if (parts.length > 1) {
    return parts.pop()!.toUpperCase().slice(0, 5);
  }
  return 'FILE';
}

function getMimeTypeColor(mimeType: string): { bg: string; text: string; label: string } {
  if (mimeType.startsWith('image/')) {
    return { bg: 'bg-rose-500/10 dark:bg-rose-500/20', text: 'text-rose-600 dark:text-rose-400', label: 'Image' };
  }
  if (mimeType.startsWith('video/')) {
    return { bg: 'bg-purple-500/10 dark:bg-purple-500/20', text: 'text-purple-600 dark:text-purple-400', label: 'Video' };
  }
  if (mimeType.startsWith('audio/')) {
    return { bg: 'bg-amber-500/10 dark:bg-amber-500/20', text: 'text-amber-600 dark:text-amber-400', label: 'Audio' };
  }
  if (mimeType.includes('pdf')) {
    return { bg: 'bg-red-500/10 dark:bg-red-500/20', text: 'text-red-600 dark:text-red-400', label: 'PDF' };
  }
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) {
    return { bg: 'bg-emerald-500/10 dark:bg-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400', label: 'Sheet' };
  }
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
    return { bg: 'bg-orange-500/10 dark:bg-orange-500/20', text: 'text-orange-600 dark:text-orange-400', label: 'Slides' };
  }
  if (mimeType.includes('document') || mimeType.includes('word') || mimeType.includes('text')) {
    return { bg: 'bg-blue-500/10 dark:bg-blue-500/20', text: 'text-blue-600 dark:text-blue-400', label: 'Doc' };
  }
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('rar') || mimeType.includes('compressed')) {
    return { bg: 'bg-amber-600/10 dark:bg-amber-600/20', text: 'text-amber-700 dark:text-amber-400', label: 'Archive' };
  }
  return { bg: 'bg-indigo-500/10 dark:bg-indigo-500/20', text: 'text-indigo-600 dark:text-indigo-400', label: 'File' };
}

function formatStorageUsage(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '0.0 GB';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.max(0, Math.floor(Math.log(bytes) / Math.log(k)));
  const val = bytes / Math.pow(k, i);
  return `${val.toFixed(1)} ${sizes[i] || 'GB'}`;
}

function formatStorageLimit(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return 'Unlimited';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.max(0, Math.floor(Math.log(bytes) / Math.log(k)));
  const val = bytes / Math.pow(k, i);
  const formatted = val % 1 === 0 ? val.toFixed(0) : val.toFixed(1);
  return `${formatted} ${sizes[i] || 'GB'}`;
}

export function DrivePage() {
  const [section, setSection] = useState<DriveViewSection>('files');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('gdu_drive_view_mode') as ViewMode | null;
      if (saved === 'list' || saved === 'grid') return saved;
    }
    return 'list';
  });
  const [items, setItems] = useState<DriveItemView[]>([]);
  const [storage, setStorage] = useState<QuotaView | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id?: string; name: string }[]>([
    { name: 'My Drive' },
  ]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [renamingItem, setRenamingItem] = useState<DriveItemView | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [failedThumbnails, setFailedThumbnails] = useState<Record<string, boolean>>({});
  const [previewItem, setPreviewItem] = useState<DriveItemView | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number>(0);

  // Debounce search query by 300ms
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Load storage quota once on mount
  const refreshStorage = useCallback(() => {
    getDriveStorage().then(setStorage).catch(() => {});
  }, []);

  useEffect(() => {
    refreshStorage();
  }, [refreshStorage]);

  const handlePreviewFile = (file: DriveItemView) => {
    const fileList = items.filter((i) => !i.isFolder);
    const idx = fileList.findIndex((f) => f.id === file.id);
    setPreviewItem(file);
    setPreviewIndex(idx >= 0 ? idx : 0);
  };

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('gdu_drive_view_mode', mode);
    }
  };

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      let res;
      if (section === 'shared') {
        res = await listSharedItems({ pageSize: 50 });
      } else if (section === 'trash') {
        res = await listTrashItems({ pageSize: 50 });
      } else {
        res = await listDriveItems({
          parentId: currentFolderId,
          query: debouncedSearchQuery || undefined,
          pageSize: 50,
        });
      }

      setItems(res.items);
    } catch (err) {
      setError((err as Error).message || 'Failed to load Drive items');
    } finally {
      setIsLoading(false);
    }
  }, [section, currentFolderId, debouncedSearchQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);


  const handleOpenFolder = (item: DriveItemView) => {
    if (item.isFolder && currentFolderId !== item.id) {
      setCurrentFolderId(item.id);
      setBreadcrumbs((prev) => {
        const existingIdx = prev.findIndex((b) => b.id === item.id);
        if (existingIdx >= 0) {
          return prev.slice(0, existingIdx + 1);
        }
        return [...prev, { id: item.id, name: item.name }];
      });
      setSearchQuery('');
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    const target = breadcrumbs[index];
    setCurrentFolderId(target.id);
    setBreadcrumbs(breadcrumbs.slice(0, index + 1));
    setSearchQuery('');
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      await createFolder(newFolderName.trim(), currentFolderId);
      setNewFolderName('');
      setShowNewFolderModal(false);
      loadData();
    } catch (err) {
      setError((err as Error).message || 'Failed to create folder');
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingItem || !renameValue.trim()) return;
    try {
      await renameItem(renamingItem.id, renameValue.trim());
      setRenamingItem(null);
      loadData();
    } catch (err) {
      setError((err as Error).message || 'Failed to rename item');
    }
  };

  const handleTrash = async (id: string) => {
    try {
      await trashItem(id);
      loadData();
    } catch (err) {
      setError((err as Error).message || 'Failed to move to trash');
    }
  };

  const handleRestore = async (id: string) => {
    try {
      await restoreItem(id);
      loadData();
    } catch (err) {
      setError((err as Error).message || 'Failed to restore item');
    }
  };

  const handleDeletePermanently = async (id: string) => {
    if (!confirm('Are you sure you want to permanently delete this item?')) return;
    try {
      await deleteItemPermanently(id);
      loadData();
    } catch (err) {
      setError((err as Error).message || 'Failed to delete item');
    }
  };

  const handleEmptyTrash = async () => {
    if (!confirm('Empty all items from Trash? This action cannot be undone.')) return;
    try {
      await emptyTrash();
      loadData();
    } catch (err) {
      setError((err as Error).message || 'Failed to empty trash');
    }
  };

  const usedStorageBytes = storage?.usage ?? 0;
  const totalStorageBytes = storage?.limit;
  const hasLimit = typeof totalStorageBytes === 'number' && totalStorageBytes > 0;
  const storageUsagePct = hasLimit
    ? Math.min(100, Math.round((usedStorageBytes / totalStorageBytes) * 100))
    : 0;

  const folders = items.filter((item) => item.isFolder);
  const files = items.filter((item) => !item.isFolder);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header & Storage Quota */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Google Drive Explorer
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Browse folders, search files, manage permissions, and preview media.
          </p>
        </div>

        {storage && (
          <div
            className="p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl min-w-[260px]"
            title={
              storage.usageInDrive
                ? `Drive: ${formatStorageUsage(storage.usageInDrive)}, Trash: ${formatStorageUsage(storage.usageInDriveTrash)}, Account Total: ${formatStorageUsage(storage.usage)}`
                : undefined
            }
          >
            <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400 font-medium mb-1.5">
              <span>Drive Storage</span>
              <span>
                {hasLimit
                  ? `${formatStorageUsage(usedStorageBytes)} of ${formatStorageLimit(totalStorageBytes)}`
                  : `${formatStorageUsage(usedStorageBytes)} used`}
              </span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-indigo-600 h-1.5 transition-all duration-300"
                style={{ width: `${hasLimit ? storageUsagePct : 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Navigation Controls: Sections, View Toggle & Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-2 rounded-2xl bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
        <div className="flex items-center gap-1">
          {(['files', 'shared', 'trash'] as const).map((s) => (
            <button
              key={s}
              onClick={() => {
                setSection(s);
                setCurrentFolderId(undefined);
                setBreadcrumbs([{ name: s === 'files' ? 'My Drive' : s === 'shared' ? 'Shared with Me' : 'Trash' }]);
              }}
              className={`px-3.5 py-1.5 rounded-xl text-sm font-semibold capitalize transition-all ${
                section === s
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {s === 'files' ? 'My Drive' : s === 'shared' ? 'Shared with Me' : 'Trash'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Material 3 Segmented Pill Toggle: List vs Grid */}
          <div className="inline-flex items-center rounded-full border border-slate-300/80 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => handleViewModeChange('list')}
              title="List view"
              aria-label="List view"
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                viewMode === 'list'
                  ? 'bg-sky-100 dark:bg-sky-950/80 text-sky-800 dark:text-sky-200 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {viewMode === 'list' && (
                <svg className="w-3.5 h-3.5 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange('grid')}
              title="Grid preview view"
              aria-label="Grid view"
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                viewMode === 'grid'
                  ? 'bg-sky-100 dark:bg-sky-950/80 text-sky-800 dark:text-sky-200 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {viewMode === 'grid' && (
                <svg className="w-3.5 h-3.5 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
                />
              </svg>
            </button>
          </div>

          {section === 'files' && (
            <button
              onClick={() => setShowNewFolderModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span>New Folder</span>
            </button>
          )}

          {section === 'trash' && items.length > 0 && (
            <button
              onClick={handleEmptyTrash}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-sm transition-colors"
            >
              <span>Empty Trash</span>
            </button>
          )}
        </div>
      </div>

      {/* Breadcrumb & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
        {/* Breadcrumb path */}
        <div className="flex items-center gap-1.5 text-xs sm:text-sm text-slate-600 dark:text-slate-400 overflow-x-auto py-1">
          {breadcrumbs.map((b, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <span className="text-slate-400">/</span>}
              <button
                onClick={() => handleBreadcrumbClick(idx)}
                className={`hover:text-indigo-600 dark:hover:text-indigo-400 truncate max-w-[120px] sm:max-w-[150px] ${
                  idx === breadcrumbs.length - 1 ? 'font-semibold text-slate-900 dark:text-white' : ''
                }`}
              >
                {b.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Search */}
        {section === 'files' && (
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-800/50 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <svg
              className="w-4 h-4 text-slate-400 absolute left-3 top-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{error}</p>
          {(error.toLowerCase().includes('auth') || error.toLowerCase().includes('google') || error.toLowerCase().includes('token')) && (
            <a
              href="/api/v1/auth/google/start"
              className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shrink-0 transition-colors shadow-xs"
            >
              Reconnect Google Drive
            </a>
          )}
        </div>
      )}

      {/* Drive Items View */}
      {isLoading ? (
        <div className="p-16 text-center text-sm text-slate-400 animate-pulse bg-white/40 dark:bg-slate-900/40 rounded-3xl border border-slate-200/80 dark:border-slate-800">
          Loading Drive files...
        </div>
      ) : items.length === 0 ? (
        <div className="p-16 text-center text-sm text-slate-400 bg-white/40 dark:bg-slate-900/40 rounded-3xl border border-slate-200/80 dark:border-slate-800">
          {section === 'trash' ? 'Trash is empty' : 'No files or folders found'}
        </div>
      ) : viewMode === 'list' ? (
        /* ======================== LIST VIEW ======================== */
        <div className="p-4 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl shadow-sm">
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((item) => {
              const isFolder = item.isFolder;

              return (
                <div
                  key={item.id}
                  className="py-3 px-2 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-xl transition-colors group"
                >
                  <div
                    onClick={() => (isFolder ? handleOpenFolder(item) : handlePreviewFile(item))}
                    className="flex items-center gap-3 min-w-0 pr-4 cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                      {isFolder ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {item.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {item.size ? `${(item.size / (1024 * 1024)).toFixed(2)} MiB` : 'Folder'} •{' '}
                        {item.modifiedTime ? new Date(item.modifiedTime).toLocaleDateString() : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5">
                    {!isFolder && (
                      <>
                        <button
                          onClick={() => handlePreviewFile(item)}
                          title="Preview file"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                        <a
                          href={getDownloadUrl(item.id)}
                          download={item.name}
                          title="Download file"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </a>
                      </>
                    )}

                    {item.webViewLink && (
                      <a
                        href={item.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open in Drive"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}

                    {section === 'trash' ? (
                      <>
                        <button
                          onClick={() => handleRestore(item.id)}
                          title="Restore item"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeletePermanently(item.id)}
                          title="Delete permanently"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setRenamingItem(item);
                            setRenameValue(item.name);
                          }}
                          title="Rename item"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleTrash(item.id)}
                          title="Move to trash"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ======================== GRID / PREVIEW VIEW ======================== */
        <div className="space-y-4 sm:space-y-6">
          {/* Folders Section in Grid */}
          {folders.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5 sm:mb-3 px-1">
                Folders ({folders.length})
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3">
                {folders.map((folder) => (
                  <div
                    key={folder.id}
                    onClick={() => handleOpenFolder(folder)}
                    className="p-2 sm:p-3.5 rounded-xl sm:rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl hover:bg-white dark:hover:bg-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700/60 shadow-xs hover:shadow-md transition-all cursor-pointer group flex flex-col justify-between"
                  >
                    <div className="flex items-center justify-between gap-1 mb-1 sm:mb-2">
                      <div className="w-7 h-7 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                        <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                      </div>

                      <div
                        className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => {
                            setRenamingItem(folder);
                            setRenameValue(folder.name);
                          }}
                          title="Rename"
                          className="p-1 rounded text-slate-400 hover:text-amber-600"
                        >
                          <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleTrash(folder.id)}
                          title="Move to trash"
                          className="p-1 rounded text-slate-400 hover:text-rose-600"
                        >
                          <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 truncate" title={folder.name}>
                        {folder.name}
                      </p>
                      <p className="text-[10px] sm:text-xs text-slate-400 mt-0.5 truncate">
                        {folder.modifiedTime ? new Date(folder.modifiedTime).toLocaleDateString() : 'Folder'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Files Section in Grid with Previews */}
          {files.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5 sm:mb-3 px-1">
                Files ({files.length})
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3.5">
                {files.map((file) => {
                  const ext = getFileExtension(file.name);
                  const mimeMeta = getMimeTypeColor(file.mimeType);
                  const isImage =
                    file.mimeType.startsWith('image/') ||
                    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext.toLowerCase());

                  const downloadUrl = getDownloadUrl(file.id);
                  let previewUrl: string | null = null;
                  if (file.thumbnailLink && !failedThumbnails[file.id]) {
                    previewUrl = file.thumbnailLink.replace(/=s\d+/, '=s400');
                  } else if (isImage && !failedThumbnails[file.id]) {
                    previewUrl = downloadUrl;
                  }

                  return (
                    <div
                      key={file.id}
                      onClick={() => handlePreviewFile(file)}
                      className="rounded-xl sm:rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl overflow-hidden shadow-xs hover:shadow-lg hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col justify-between group cursor-pointer"
                    >
                      {/* File Preview Banner / Thumbnail */}
                      <div className="relative aspect-video w-full bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center overflow-hidden border-b border-slate-100 dark:border-slate-800">
                        {previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={file.name}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              if (isImage && e.currentTarget.src !== downloadUrl && !e.currentTarget.src.endsWith(downloadUrl)) {
                                e.currentTarget.src = downloadUrl;
                              } else {
                                setFailedThumbnails((prev) => ({ ...prev, [file.id]: true }));
                              }
                            }}
                            className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className={`w-full h-full flex flex-col items-center justify-center ${mimeMeta.bg}`}>
                            <svg
                              className={`w-7 h-7 sm:w-10 sm:h-10 ${mimeMeta.text} mb-0.5 sm:mb-1 opacity-80`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                              />
                            </svg>
                            <span className={`text-[8px] sm:text-[10px] font-bold uppercase tracking-wider ${mimeMeta.text}`}>
                              {mimeMeta.label}
                            </span>
                          </div>
                        )}

                        {/* Format Badge */}
                        <div className="absolute top-1 right-1 sm:top-2 sm:right-2 px-1 sm:px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-mono font-bold bg-slate-900/70 backdrop-blur-md text-white shadow-xs">
                          {ext}
                        </div>
                      </div>


                      {/* Card Content & Metadata */}
                      <div className="p-2 sm:p-3.5 flex flex-col justify-between flex-1 min-w-0">
                        <div>
                          <p
                            className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 line-clamp-2 leading-tight break-words"
                            title={file.name}
                          >
                            {file.name}
                          </p>
                          <p className="text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1 truncate">
                            {file.size ? `${(file.size / (1024 * 1024)).toFixed(2)} MiB` : '—'} •{' '}
                            {file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : '—'}
                          </p>
                        </div>

                        {/* Card Action Footer */}
                        <div className="flex items-center justify-between gap-0.5 pt-1.5 sm:pt-2.5 mt-1.5 sm:mt-2.5 border-t border-slate-100 dark:border-slate-800/80">
                          <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handlePreviewFile(file)}
                              title="Preview"
                              className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors"
                            >
                              <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            </button>
                            <a
                              href={getDownloadUrl(file.id)}
                              download={file.name}
                              title="Download"
                              className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors"
                            >
                              <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                            </a>

                            {file.webViewLink && (
                              <a
                                href={file.webViewLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open in Drive"
                                className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                              >
                                <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            )}
                          </div>

                          <div className="flex items-center gap-0.5">
                            {section === 'trash' ? (
                              <>
                                <button
                                  onClick={() => handleRestore(file.id)}
                                  title="Restore"
                                  className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                                >
                                  <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => handleDeletePermanently(file.id)}
                                  title="Delete permanently"
                                  className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                                >
                                  <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => {
                                    setRenamingItem(file);
                                    setRenameValue(file.name);
                                  }}
                                  title="Rename"
                                  className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                                >
                                  <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => handleTrash(file.id)}
                                  title="Move to trash"
                                  className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                                >
                                  <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreateFolder}
            className="w-full max-w-sm bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">New Folder</h3>
            <input
              type="text"
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              required
              autoFocus
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-800/50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewFolderModal(false)}
                className="py-2 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rename Item Modal */}
      {renamingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <form
            onSubmit={handleRename}
            className="w-full max-w-sm bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Rename</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              required
              autoFocus
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-800/50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenamingItem(null)}
                className="py-2 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {/* File Preview Dialog */}
      {previewItem && (
        <FilePreview
          open={!!previewItem}
          onClose={() => setPreviewItem(null)}
          fileId={previewItem.id}
          fileName={previewItem.name}
          mimeType={previewItem.mimeType}
          fileSize={previewItem.size}
          modifiedTime={previewItem.modifiedTime}
          createdTime={previewItem.createdTime}
          thumbnailLink={previewItem.thumbnailLink}
          webViewLink={previewItem.webViewLink}
          owners={previewItem.owners}
          files={files}
          currentIndex={previewIndex}
          onNavigate={(idx) => {
            setPreviewIndex(idx);
            if (files[idx]) {
              setPreviewItem(files[idx]);
            }
          }}
        />
      )}
    </div>
  );
}

