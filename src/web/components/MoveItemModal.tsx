import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DriveItemView } from '../../shared/contracts';
import { listDriveFolders, createFolder } from '../api/drive';

interface MoveItemModalProps {
  isOpen: boolean;
  item: DriveItemView | null;
  currentFolderId?: string;
  onClose: () => void;
  onMoved: (item: DriveItemView, destinationFolderId?: string, destinationFolderName?: string) => Promise<void> | void;
}

export function MoveItemModal({
  isOpen,
  item,
  currentFolderId,
  onClose,
  onMoved,
}: MoveItemModalProps) {
  const [currentBrowseId, setCurrentBrowseId] = useState<string | undefined>(undefined);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id?: string; name: string }[]>([
    { id: undefined, name: 'My Drive' },
  ]);
  const [folders, setFolders] = useState<DriveItemView[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline new folder creation state
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingLoading, setIsCreatingLoading] = useState(false);

  // Selected destination folder (defaults to current browse level)
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(undefined);
  const [selectedFolderName, setSelectedFolderName] = useState<string>('My Drive');

  // Reset browse state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentBrowseId(undefined);
      setBreadcrumbs([{ id: undefined, name: 'My Drive' }]);
      setSelectedFolderId(undefined);
      setSelectedFolderName('My Drive');
      setError(null);
      setIsCreatingFolder(false);
      setNewFolderName('');
    }
  }, [isOpen]);

  const loadFolders = useCallback(async (parentId?: string, pageToken?: string) => {
    try {
      if (pageToken) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }
      setError(null);
      const res = await listDriveFolders({ parentId, pageToken, pageSize: 50 });
      setFolders((prev) => (pageToken ? [...prev, ...res.items] : res.items));
      setNextPageToken(res.nextPageToken || null);
    } catch (err) {
      setError((err as Error).message || 'Failed to load folders');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadFolders(currentBrowseId);
    }
  }, [isOpen, currentBrowseId, loadFolders]);

  const handleOpenFolder = (folder: DriveItemView) => {
    // If moving a folder, prevent opening itself
    if (item?.isFolder && folder.id === item.id) return;
    setFolders([]);
    setNextPageToken(null);
    setCurrentBrowseId(folder.id);
    setSelectedFolderId(folder.id);
    setSelectedFolderName(folder.name);
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const handleBreadcrumbClick = (crumb: { id?: string; name: string }, idx: number) => {
    setFolders([]);
    setNextPageToken(null);
    setBreadcrumbs((prev) => prev.slice(0, idx + 1));
    setCurrentBrowseId(crumb.id);
    setSelectedFolderId(crumb.id);
    setSelectedFolderName(crumb.name);
    if (crumb.id === currentBrowseId) {
      loadFolders(crumb.id);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      setIsCreatingLoading(true);
      const created = await createFolder(newFolderName.trim(), currentBrowseId);
      setFolders((prev) => [created, ...prev]);
      setSelectedFolderId(created.id);
      setSelectedFolderName(created.name);
      setNewFolderName('');
      setIsCreatingFolder(false);
    } catch (err) {
      setError((err as Error).message || 'Failed to create folder');
    } finally {
      setIsCreatingLoading(false);
    }
  };

  const handleExecuteMove = async () => {
    if (!item) return;
    try {
      setIsMoving(true);
      setError(null);
      await onMoved(item, selectedFolderId, selectedFolderName);
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Failed to move item');
    } finally {
      setIsMoving(false);
    }
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape' && !isMoving) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isMoving, onClose]);

  if (!isOpen || !item) return null;

  // Validation: Check if destination is same as item's current location
  const isCurrentLocation =
    (selectedFolderId === undefined && !currentFolderId) ||
    selectedFolderId === currentFolderId ||
    (item.parents && item.parents.length > 0 && selectedFolderId === item.parents[0]);

  // Validation: If moving a folder, destination cannot be the folder itself
  const isMovingIntoSelf = item.isFolder && selectedFolderId === item.id;

  const isMoveDisabled = isMoving || isCurrentLocation || isMovingIntoSelf;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isMoving) onClose();
      }}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-800/20">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-accent-light dark:bg-accent-dark text-accent dark:text-accent-textDark flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 13l3 3m0 0l-3 3m3-3H9" />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
                Move &quot;{item.name}&quot;
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Choose a destination folder in Google Drive
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isMoving}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            title="Close modal"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Breadcrumb Navigation & Controls */}
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 bg-slate-50/30 dark:bg-slate-800/10 shrink-0 overflow-x-auto text-xs">
          <div className="flex items-center gap-1 min-w-0 text-slate-600 dark:text-slate-300 font-medium overflow-x-auto py-0.5">
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <React.Fragment key={crumb.id || 'root'}>
                  {idx > 0 && <span className="text-slate-300 dark:text-slate-600">/</span>}
                  <button
                    onClick={() => handleBreadcrumbClick(crumb, idx)}
                    className={`hover:text-accent truncate transition-colors py-0.5 px-1.5 rounded-md ${
                      isLast
                        ? 'font-semibold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800'
                        : 'text-slate-500 hover:bg-slate-100/70 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          <button
            onClick={() => setIsCreatingFolder((prev) => !prev)}
            title="Create new subfolder here"
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-accent dark:text-accent-textDark hover:bg-accent-light dark:hover:bg-accent-dark border border-accent-border transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span>New Folder</span>
          </button>
        </div>

        {/* Inline New Folder Form */}
        {isCreatingFolder && (
          <form
            onSubmit={handleCreateFolder}
            className="p-3 bg-accent-light/40 dark:bg-accent-dark/30 border-b border-accent-border flex items-center gap-2 shrink-0 animate-fade-in"
          >
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="New folder name..."
              autoFocus
              className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-accent"
            />
            <button
              type="submit"
              disabled={isCreatingLoading || !newFolderName.trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isCreatingLoading ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => setIsCreatingFolder(false)}
              className="px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
          </form>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mx-5 my-2.5 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="truncate">{error}</span>
          </div>
        )}

        {/* Current Destination Selector Badge */}
        <div className="px-5 py-2.5 bg-slate-50/80 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400">Destination:</span>
          <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
            <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="truncate max-w-[220px]">{selectedFolderName}</span>
          </div>
        </div>

        {/* Folder List Scroll Area */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1 min-h-[180px] max-h-[320px]">
          {isLoading ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-xl animate-pulse">
                  <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-800" />
                  <div className="h-4 w-36 rounded bg-slate-200 dark:bg-slate-800" />
                </div>
              ))}
            </div>
          ) : folders.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              No subfolders in this folder.
            </div>
          ) : (
            folders.map((folder) => {
              const isSelf = item.isFolder && folder.id === item.id;
              const isSelected = selectedFolderId === folder.id;

              return (
                <div
                  key={folder.id}
                  onClick={() => {
                    if (isSelf) return;
                    setSelectedFolderId(folder.id);
                    setSelectedFolderName(folder.name);
                  }}
                  className={`flex items-center justify-between p-2 sm:p-2.5 rounded-xl text-xs transition-all cursor-pointer group ${
                    isSelf
                      ? 'opacity-40 cursor-not-allowed bg-slate-100/50 dark:bg-slate-800/30'
                      : isSelected
                      ? 'bg-accent-light dark:bg-accent-dark text-accent dark:text-accent-textDark font-semibold ring-1 ring-accent'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <svg
                      className={`w-4 h-4 shrink-0 ${isSelected ? 'text-accent' : 'text-slate-400 group-hover:text-accent'}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="truncate">{folder.name}</span>
                    {isSelf && (
                      <span className="shrink-0 text-[10px] text-amber-500 font-normal">
                        (Current folder)
                      </span>
                    )}
                  </div>

                  {!isSelf && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenFolder(folder);
                      }}
                      title={`Open ${folder.name}`}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })
          )}

          {nextPageToken && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => loadFolders(currentBrowseId, nextPageToken)}
                disabled={isLoadingMore}
                className="px-3 py-1 rounded-lg text-xs font-semibold text-accent hover:bg-accent-light dark:hover:bg-accent-dark transition-colors disabled:opacity-50"
              >
                {isLoadingMore ? 'Loading more...' : 'Load more folders'}
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 sm:px-6 sm:py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-800/20">
          <button
            type="button"
            onClick={onClose}
            disabled={isMoving}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleExecuteMove}
            disabled={isMoveDisabled}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-white bg-accent hover:opacity-90 transition-all shadow-md shadow-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isMoving && (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            <span>
              {isMoving
                ? 'Moving...'
                : isCurrentLocation
                ? 'Already in this folder'
                : isMovingIntoSelf
                ? 'Cannot move into itself'
                : `Move to ${selectedFolderName}`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
