import React, { useState, useEffect, useCallback, useRef } from 'react';
import { listDriveFolders } from '../api/drive';
import { DriveItemView } from '../../shared/contracts';

interface FolderPickerProps {
  selectedFolderId?: string;
  selectedFolderName?: string;
  onSelect: (folderId: string | undefined, folderName: string) => void;
  className?: string;
}

export function FolderPicker({
  selectedFolderId,
  selectedFolderName = 'My Drive (Root)',
  onSelect,
  className = '',
}: FolderPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentParentId, setCurrentParentId] = useState<string | undefined>(undefined);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id?: string; name: string }[]>([
    { id: undefined, name: 'My Drive' },
  ]);
  const [folders, setFolders] = useState<DriveItemView[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFolders = useCallback(async (parentId?: string, pageToken?: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await listDriveFolders({ parentId, pageToken, pageSize: 50 });
      setFolders((current) => (pageToken ? [...current, ...res.items] : res.items));
      setNextPageToken(res.nextPageToken || null);
    } catch (err) {
      setError((err as Error).message || 'Failed to load folders');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadFolders(currentParentId);
    }
  }, [isOpen, currentParentId, loadFolders]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleOpenSubFolder = (folder: DriveItemView, e: React.MouseEvent) => {
    e.stopPropagation();
    setFolders([]);
    setNextPageToken(null);
    setCurrentParentId(folder.id);
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const handleBreadcrumbClick = (crumb: { id?: string; name: string }, idx: number) => {
    setFolders([]);
    setNextPageToken(null);
    setBreadcrumbs((prev) => prev.slice(0, idx + 1));

    if (crumb.id === currentParentId) {
      // Re-clicking the active crumb leaves currentParentId untouched, so the
      // load effect never re-fires — refetch explicitly or the list stays empty.
      loadFolders(crumb.id);
    } else {
      setCurrentParentId(crumb.id);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${isOpen ? 'z-50' : 'z-10'} ${className}`}>
      {/* Folder Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/50 dark:bg-slate-800/50 hover:bg-slate-100/80 dark:hover:bg-slate-800 text-xs text-slate-700 dark:text-slate-200 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
          </svg>
          <span className="font-medium truncate">
            Destination: <strong className="font-semibold text-slate-900 dark:text-white">{selectedFolderName}</strong>
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Popover Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-black/5 dark:ring-white/10 space-y-3 animate-fade-in">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs text-slate-500 dark:text-slate-400">
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.id || 'root'}>
                {idx > 0 && <span>/</span>}
                <button
                  type="button"
                  onClick={() => handleBreadcrumbClick(crumb, idx)}
                  className={`hover:text-indigo-600 dark:hover:text-indigo-400 shrink-0 ${
                    idx === breadcrumbs.length - 1 ? 'font-semibold text-indigo-600 dark:text-indigo-400' : ''
                  }`}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* Current Selection Confirmation */}
          <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
            <span className="text-[11px] text-slate-400">Select current folder:</span>
            <button
              type="button"
              onClick={() => {
                const activeCrumb = breadcrumbs[breadcrumbs.length - 1];
                onSelect(activeCrumb.id, activeCrumb.name);
                setIsOpen(false);
              }}
              className="px-3 py-1 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shadow-xs"
            >
              Choose this Folder
            </button>
          </div>

          {/* Folder List */}
          <div className="max-h-48 overflow-y-auto space-y-1 divide-y divide-slate-100 dark:divide-slate-800/60">
            {isLoading ? (
              <p className="text-xs text-slate-400 text-center py-4">Loading folders...</p>
            ) : error ? (
              <p className="text-xs text-rose-500 text-center py-2">{error}</p>
            ) : folders.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">No subfolders here</p>
            ) : (
              folders.map((folder) => {
                const isSelected = selectedFolderId === folder.id;
                return (
                  <div
                    key={folder.id}
                    onClick={() => {
                      onSelect(folder.id, folder.name);
                      setIsOpen(false);
                    }}
                    className={`flex items-center justify-between p-2 rounded-xl cursor-pointer text-xs transition-colors ${
                      isSelected
                        ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-semibold'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <svg className="w-4 h-4 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                      </svg>
                      <span className="truncate">{folder.name}</span>
                    </div>

                    <button
                      type="button"
                      title="Browse into folder"
                      onClick={(e) => handleOpenSubFolder(folder, e)}
                      className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                );
              })
            )}
            {nextPageToken && (
              <button
                type="button"
                disabled={isLoading}
                onClick={() => loadFolders(currentParentId, nextPageToken)}
                className="w-full py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 disabled:opacity-50"
              >
                {isLoading ? 'Loading folders...' : 'Load more folders'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
