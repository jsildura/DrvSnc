import React, { useState, useEffect, useCallback, useMemo, useRef, startTransition } from 'react';
import { useOptionalApp } from '../state/AppProvider';
import { pathForTab, AppTab } from '../state/tabRoute';
import { DriveItemView, DrivePage as DrivePageResponse, QuotaView, detectVideoQuality } from '../../shared/contracts';
import { SelectedDriveFile } from '../converter/types';
import {
  listDriveItems,
  listSharedItems,
  listStarredItems,
  listTrashItems,
  getDriveStorage,
  createFolder,
  renameItem,
  copyDriveFile,
  starDriveItem,
  moveItem,
  trashItem,
  restoreItem,
  deleteItemPermanently,
  emptyTrash,
  batchDriveOperation,
  getDownloadUrl,
} from '../api/drive';
import FilePreview from '../../components/FilePreview';
import ShareModal from '../components/ShareModal';
import { ExtractArchiveModal } from '../components/ExtractArchiveModal';
import { MoveItemModal } from '../components/MoveItemModal';
import { driveCache } from '../services/driveCache';
import { isArchiveFile } from '../../shared/archiveUtils';


type DriveViewSection = 'files' | 'shared' | 'starred' | 'trash';
type ViewMode = 'list' | 'grid';
type ToastAction = {
  label: string;
  onClick: () => void | Promise<void>;
};

type Toast = {
  id: number;
  message: string;
  variant: 'success' | 'error';
  action?: ToastAction;
  durationMs?: number;
  exiting?: boolean;
};

const TOAST_DURATION_MS = 4000;
const ACTION_TOAST_DURATION_MS = 5500;

const VIDEO_EXTS = /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|3gp|ts|mts|m2ts|vob|ogv|mpg|mpeg)$/i;
const AUDIO_EXTS = /\.(mp3|wav|m4a|m4r|flac|ogg|oga|opus|mp2|amr|aac|wma|aiff|aif|alac|ape|ac3|dts|mid|midi)$/i;
const DOC_EXTS = /\.(pdf|docx?|txt|rtf|odt|html?|epub|mobi|xlsx?|pptx?|csv|xml)$/i;

function isExtractableArchive(item: DriveItemView): boolean {
  if (item.isFolder) return false;
  return isArchiveFile(item.name, item.mimeType);
}

function isConvertibleVideo(item: DriveItemView): boolean {
  if (item.isFolder) return false;
  return Boolean(item.mimeType?.startsWith('video/') || VIDEO_EXTS.test(item.name));
}

function isConvertibleAudio(item: DriveItemView): boolean {
  if (item.isFolder) return false;
  return Boolean(item.mimeType?.startsWith('audio/') || AUDIO_EXTS.test(item.name));
}

function isConvertibleDoc(item: DriveItemView): boolean {
  if (item.isFolder) return false;
  const mime = item.mimeType || '';
  return Boolean(
    mime === 'application/pdf' ||
    mime.includes('document') ||
    mime.includes('spreadsheet') ||
    mime.includes('presentation') ||
    mime.startsWith('text/') ||
    DOC_EXTS.test(item.name)
  );
}

function getFileExtension(name: string): string {
  const parts = name.split('.');
  if (parts.length > 1) {
    return parts.pop()!.toUpperCase().slice(0, 5);
  }
  return 'FILE';
}

function FolderIcon({ shared, className = 'w-4 h-4' }: { shared?: boolean; className?: string }) {
  if (shared) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-label="Shared folder">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2zM12 8a2 2 0 110 4 2 2 0 010-4zm0 5c2.33 0 4.31 1.46 5.11 3.5H6.89c.8-2.04 2.78-3.5 5.11-3.5z"
        />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-label="Folder">
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
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

const probedVideoQualityCache = new Map<string, string | null>();

function SelectionCheckbox({
  selected,
  onClick,
  className = '',
}: {
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      aria-label={selected ? 'Deselect item' : 'Select item'}
      className={`w-3.5 h-3.5 sm:w-4 sm:h-4 lg:w-5 lg:h-5 rounded-full flex items-center justify-center transition-all cursor-pointer ${selected
          ? 'bg-accent text-accent-contrast shadow-xs ring-1.5 lg:ring-2 ring-accent/40 dark:ring-accent-ring scale-100'
          : 'border-[1.5px] lg:border-2 border-slate-400/80 dark:border-slate-500 bg-white/95 dark:bg-slate-800/95 hover:border-accent dark:hover:border-accent-textDark hover:scale-105'
        } ${className}`}
    >
      {selected ? (
        <svg className="w-2.5 h-2.5 sm:w-2.5 sm:h-2.5 lg:w-3.5 lg:h-3.5 stroke-[3]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : null}
    </button>
  );
}

function BackToTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setShow(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <button
      type="button"
      onClick={scrollToTop}
      title="Back to top"
      aria-label="Back to top"
      data-testid="back-to-top"
      className={`fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-40 p-2.5 sm:p-3 rounded-2xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-900/10 dark:shadow-black/40 text-slate-600 dark:text-slate-300 hover:text-accent dark:hover:text-accent-textDark hover:border-accent-border hover:scale-105 active:scale-95 transition-all duration-300 cursor-pointer ${
        show
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-4 pointer-events-none'
      }`}
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 15l7-7 7 7" />
      </svg>
    </button>
  );
}

export function DrivePage() {
  const app = useOptionalApp();
  const setActiveTab =
    app?.setActiveTab ||
    ((tab: AppTab) => {
      if (typeof window !== 'undefined') {
        window.history.pushState({ tab }, '', pathForTab(tab));
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    });

  const handleConvertFile = (item: DriveItemView) => {
    const fileToConvert: SelectedDriveFile = {
      id: item.id,
      name: item.name,
      sizeBytes: item.size || 0,
      mimeType: item.mimeType || 'application/octet-stream',
      parentFolderId: item.parents?.[0] || currentFolderId || undefined,
      videoMetadata: item.videoMediaMetadata
        ? {
          width: item.videoMediaMetadata.width ?? undefined,
          height: item.videoMediaMetadata.height ?? undefined,
          durationMillis:
            item.videoMediaMetadata.durationMillis != null
              ? Number(item.videoMediaMetadata.durationMillis)
              : undefined,
        }
        : undefined,
    };

    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('gdu_pending_converter_file', JSON.stringify(fileToConvert));
      }
    } catch {
      // ignore
    }

    if (app?.navigateToConverter) {
      app.navigateToConverter(fileToConvert);
    } else {
      setActiveTab('converter');
    }
  };
  const [section, setSection] = useState<DriveViewSection>('files');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('gdu_drive_view_mode') as ViewMode | null;
      if (saved === 'list' || saved === 'grid') return saved;
    }
    return 'list';
  });
  const [visualViewMode, setVisualViewMode] = useState<ViewMode>(viewMode);

  useEffect(() => {
    setVisualViewMode(viewMode);
  }, [viewMode]);
  const [items, setItems] = useState<DriveItemView[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [storage, setStorage] = useState<QuotaView | null>(null);
  const [storageLoading, setStorageLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id?: string; name: string }[]>([
    { name: 'My Drive' },
  ]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  // Modals state
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [renamingItem, setRenamingItem] = useState<DriveItemView | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [failedThumbnails, setFailedThumbnails] = useState<Record<string, boolean>>({});
  const [loadedThumbnails, setLoadedThumbnails] = useState<Record<string, boolean>>({});
  const [previewItem, setPreviewItem] = useState<DriveItemView | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number>(0);
  const [sharingItem, setSharingItem] = useState<DriveItemView | null>(null);
  const [extractingItem, setExtractingItem] = useState<DriveItemView | null>(null);
  const [movingItem, setMovingItem] = useState<DriveItemView | null>(null);

  // Drag-and-drop states (desktop mouse)
  const [draggedItem, setDraggedItem] = useState<DriveItemView | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activeMenuFileId, setActiveMenuFileId] = useState<string | null>(null);
  const [probedQuality, setProbedQuality] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const [id, quality] of probedVideoQualityCache.entries()) {
      if (quality) initial[id] = quality;
    }
    return initial;
  });
  const probingRef = useRef<Record<string, boolean>>({});

  const handleCopyItemLink = async (item: DriveItemView) => {
    const targetId = item.targetId || item.id;
    const link =
      item.webViewLink ||
      (item.isFolder
        ? `https://drive.google.com/drive/folders/${targetId}`
        : `https://drive.google.com/file/d/${targetId}/view`);
    try {
      await navigator.clipboard.writeText(link);
      showToast('Link copied to clipboard');
    } catch (err) {
      console.error('Failed to copy link:', err);
      showToast('Failed to copy link', 'error');
    }
  };

  const getVideoQuality = useCallback(
    (file: DriveItemView): string | null => {
      if (!isConvertibleVideo(file)) return null;
      if (file.videoQuality) return file.videoQuality;
      const detected = detectVideoQuality(file.videoMediaMetadata, file.name);
      if (detected) return detected;
      return probedQuality[file.id] || probedVideoQualityCache.get(file.id) || null;
    },
    [probedQuality]
  );

  // Lazy probe quality for videos without metadata in browser environment
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const candidates = items.filter(
      (f) =>
        isConvertibleVideo(f) &&
        f.canDownload !== false &&
        !f.videoQuality &&
        !detectVideoQuality(f.videoMediaMetadata, f.name) &&
        !probedQuality[f.id] &&
        !probingRef.current[f.id] &&
        !probedVideoQualityCache.has(f.id)
    );
    if (candidates.length === 0) return;

    for (const f of candidates) {
      const fileId = f.id;
      probingRef.current[fileId] = true;
      try {
        const v = document.createElement('video');
        v.preload = 'metadata';
        let timer: ReturnType<typeof setTimeout> | null = null;
        const cleanup = () => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          v.onloadedmetadata = null;
          v.onerror = null;
          v.removeAttribute('src');
          v.load();
        };

        timer = setTimeout(() => {
          if (!probedVideoQualityCache.has(fileId)) {
            probedVideoQualityCache.set(fileId, null);
          }
          cleanup();
        }, 8000);

        v.onloadedmetadata = () => {
          if (v.videoHeight > 0) {
            const q = detectVideoQuality({ width: v.videoWidth, height: v.videoHeight });
            if (q) {
              probedVideoQualityCache.set(fileId, q);
              setProbedQuality((prev) => ({ ...prev, [fileId]: q }));
            } else {
              probedVideoQualityCache.set(fileId, null);
            }
          } else {
            probedVideoQualityCache.set(fileId, null);
          }
          cleanup();
        };

        v.onerror = () => {
          // Record failure so we never spam download requests on tab changes
          probedVideoQualityCache.set(fileId, null);
          cleanup();
        };

        v.src = getDownloadUrl(f.targetId || f.id);
      } catch {
        probedVideoQualityCache.set(fileId, null);
      }
    }
  }, [items, probedQuality]);

  const toastIdRef = useRef(0);
  const toastTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // Ids we removed locally (trashed / restored / deleted). Drive's list API is
  // eventually consistent, so a reload that happens shortly after a mutation — a
  // rename or a new folder, say — can still return them. Filter them out until the
  // view changes, at which point a trashed file legitimately belongs in the listing.
  const removedIdsRef = useRef<Set<string>>(new Set());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const currentFolderIdRef = useRef(currentFolderId);
  currentFolderIdRef.current = currentFolderId;

  useEffect(() => {
    return () => {
      for (const timer of toastTimersRef.current.values()) {
        clearTimeout(timer);
      }
      toastTimersRef.current.clear();
    };
  }, []);

  const dismissToast = useCallback((id: number) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    // Trigger exit animation, then remove after it completes
    setToasts((prev) => {
      const target = prev.find((t) => t.id === id);
      if (!target || target.exiting) return prev;
      return prev.map((t) => (t.id === id ? { ...t, exiting: true } : t));
    });
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 200);
  }, []);

  const showToast = useCallback(
    (
      message: string,
      variant: Toast['variant'] = 'success',
      options?: {
        action?: ToastAction;
        durationMs?: number;
      }
    ) => {
      const id = ++toastIdRef.current;
      const duration = options?.durationMs ?? TOAST_DURATION_MS;

      // Cancel auto-dismiss timers for older toasts so they immediately transition out
      for (const timer of toastTimersRef.current.values()) {
        clearTimeout(timer);
      }
      toastTimersRef.current.clear();

      // Mark older toasts as exiting and introduce the new active toast
      setToasts((prev) => {
        const exitingOlder = prev.map((t) => ({ ...t, exiting: true }));
        return [
          ...exitingOlder,
          {
            id,
            message,
            variant,
            action: options?.action,
            durationMs: duration,
          },
        ];
      });

      // Clean up older exiting toasts after their 200ms exit transition
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => !t.exiting || t.id === id));
      }, 200);

      const timer = setTimeout(() => dismissToast(id), duration);
      toastTimersRef.current.set(id, timer);
    },
    [dismissToast]
  );

  const reportMutationError = useCallback(
    (err: unknown, fallback: string) => {
      const message = (err as Error)?.message || fallback;
      showToast(message, 'error');
      // Keep the inline banner for auth failures so "Reconnect Google Drive" stays reachable.
      if (/auth|google|token/i.test(message)) setError(message);
    },
    [showToast]
  );

  // Drop an item from the visible list right away and remember it, so an
  // eventually-consistent reload can't resurrect it. Call this *before* awaiting
  // the mutation: the round-trip through the worker to Drive takes seconds, and
  // waiting for it leaves the row sitting there looking unresponsive.
  // Returns a rollback that puts the row back in place if the mutation fails.
  const forgetItem = useCallback((id: string, snapshot: DriveItemView[]) => {
    removedIdsRef.current.add(id);
    setItems((prev) => prev.filter((i) => i.id !== id));

    const index = snapshot.findIndex((i) => i.id === id);
    const item = index >= 0 ? snapshot[index] : null;

    return () => {
      removedIdsRef.current.delete(id);
      if (!item) return;
      setItems((prev) =>
        prev.some((i) => i.id === id)
          ? prev
          : [...prev.slice(0, index), item, ...prev.slice(index)]
      );
    };
  }, []);

  // Debounce search query by 300ms
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Touch & Drag-and-drop safety for touch-capable devices
  const isTouchInteractingRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressPosRef = useRef<{ x: number; y: number } | null>(null);
  const isLongPressActiveRef = useRef(false);
  const justFinishedLongPressRef = useRef(false);
  const clearJustFinishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTouchLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressPosRef.current = null;
  }, []);

  const triggerLongPressAction = useCallback((itemId: string) => {
    if (isTouchInteractingRef.current) {
      isLongPressActiveRef.current = true;
      justFinishedLongPressRef.current = true;
      if (clearJustFinishedTimerRef.current) {
        clearTimeout(clearJustFinishedTimerRef.current);
        clearJustFinishedTimerRef.current = null;
      }
    }
    setActiveMenuFileId(itemId);
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(30);
      } catch {
        // ignore
      }
    }
  }, []);

  const handleItemTouchStart = useCallback(
    (itemId: string, e: React.PointerEvent) => {
      cancelTouchLongPress();
      isLongPressActiveRef.current = false;
      longPressPosRef.current = { x: e.clientX, y: e.clientY };
      longPressTimerRef.current = setTimeout(() => {
        triggerLongPressAction(itemId);
      }, 450);
    },
    [cancelTouchLongPress, triggerLongPressAction]
  );

  const handleItemTouchMove = useCallback(
    (e: React.PointerEvent) => {
      if (longPressPosRef.current) {
        const dx = Math.abs(e.clientX - longPressPosRef.current.x);
        const dy = Math.abs(e.clientY - longPressPosRef.current.y);
        if (dx > 16 || dy > 16) {
          cancelTouchLongPress();
        }
      }
    },
    [cancelTouchLongPress]
  );

  const handleItemPointerUp = useCallback(() => {
    cancelTouchLongPress();
    if (isLongPressActiveRef.current) {
      isLongPressActiveRef.current = false;
      justFinishedLongPressRef.current = true;
      if (clearJustFinishedTimerRef.current) {
        clearTimeout(clearJustFinishedTimerRef.current);
      }
      clearJustFinishedTimerRef.current = setTimeout(() => {
        justFinishedLongPressRef.current = false;
      }, 400);
    }
  }, [cancelTouchLongPress]);

  const handleItemPointerDown = useCallback(
    (itemId: string, e: React.PointerEvent<HTMLElement>) => {
      // Don't start long-press gesture if user tapped on a button, input, link or active menu
      if ((e.target as HTMLElement)?.closest('button, [data-actions-menu], input, a')) {
        return;
      }
      if (e.pointerType === 'touch' || e.pointerType === 'pen' || isTouchInteractingRef.current) {
        isTouchInteractingRef.current = true;
        e.currentTarget.draggable = false;
        handleItemTouchStart(itemId, e);
      } else if (section !== 'trash') {
        e.currentTarget.draggable = true;
      }
    },
    [handleItemTouchStart, section]
  );

  const handleItemPointerEnter = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && section !== 'trash') {
        e.currentTarget.draggable = true;
      }
    },
    [section]
  );

  const handleItemPointerLeave = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.currentTarget.draggable = false;
      cancelTouchLongPress();
    },
    [cancelTouchLongPress]
  );

  const handleItemContextMenu = useCallback(
    (itemId: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      cancelTouchLongPress();
      triggerLongPressAction(itemId);
    },
    [cancelTouchLongPress, triggerLongPressAction]
  );

  const handleItemDragStart = useCallback(
    (e: React.DragEvent, item: DriveItemView) => {
      if (isTouchInteractingRef.current) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData('text/plain', item.id);
      setDraggedItem(item);
    },
    []
  );

  // Global touch and drag-and-drop safety cleanup
  useEffect(() => {
    const handleTouchStart = () => {
      isTouchInteractingRef.current = true;
    };
    const handleTouchEnd = () => {
      if (isLongPressActiveRef.current) {
        isLongPressActiveRef.current = false;
        justFinishedLongPressRef.current = true;
        if (clearJustFinishedTimerRef.current) {
          clearTimeout(clearJustFinishedTimerRef.current);
        }
        clearJustFinishedTimerRef.current = setTimeout(() => {
          justFinishedLongPressRef.current = false;
        }, 400);
      }
      cancelTouchLongPress();
      setTimeout(() => {
        isTouchInteractingRef.current = false;
      }, 400);
    };
    const handleMouseMove = () => {
      isTouchInteractingRef.current = false;
    };
    const handleGlobalDragEnd = () => {
      setDraggedItem(null);
      setDropTargetFolderId(null);
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('dragend', handleGlobalDragEnd);
    window.addEventListener('drop', handleGlobalDragEnd);

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('dragend', handleGlobalDragEnd);
      window.removeEventListener('drop', handleGlobalDragEnd);
    };
  }, [cancelTouchLongPress]);

  // Close more-actions dropdown when clicking or tapping outside
  useEffect(() => {
    if (!activeMenuFileId) return;
    const handleOutsideClick = (e: MouseEvent | PointerEvent) => {
      // If a touch long-press just finished, ignore the trailing synthetic click event
      if (justFinishedLongPressRef.current && e.type === 'click') {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-actions-menu]') || target?.closest('[data-actions-button]')) {
        return;
      }
      setActiveMenuFileId(null);
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    document.addEventListener('click', handleOutsideClick);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick);
      document.removeEventListener('click', handleOutsideClick);
    };
  }, [activeMenuFileId]);

  // Load storage quota once on mount
  const refreshStorage = useCallback(() => {
    setStorageLoading(true);
    getDriveStorage()
      .then(setStorage)
      .catch(() => { })
      .finally(() => setStorageLoading(false));
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
    if (mode === visualViewMode) return;
    setVisualViewMode(mode);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('gdu_drive_view_mode', mode);
    }
    // High-fps optimization for low-end devices: start GPU animation immediately, defer DOM mount
    requestAnimationFrame(() => {
      startTransition(() => {
        setViewMode(mode);
      });
    });
  };

  const loadData = useCallback(
    async (forceRefresh = false) => {
      const removed = removedIdsRef.current;
      const isSearchActive = Boolean(debouncedSearchQuery);

      // SWR Cache Check: if not forcing refresh and not searching, try cache
      if (!forceRefresh && !isSearchActive) {
        const cached = driveCache.getCachedFolder(section, currentFolderId);
        if (cached.status === 'fresh' && cached.data) {
          const validItems =
            removed.size > 0
              ? cached.data.items.filter((i) => !removed.has(i.id))
              : cached.data.items;
          setItems(validItems);
          setNextPageToken(cached.data.nextPageToken || null);
          setIsLoading(false);
          setIsRevalidating(false);
          setError(null);
          return;
        }

        if (cached.status === 'stale' && cached.data) {
          // Serve stale data immediately for instant 0ms render without skeleton
          const validItems =
            removed.size > 0
              ? cached.data.items.filter((i) => !removed.has(i.id))
              : cached.data.items;
          setItems(validItems);
          setNextPageToken(cached.data.nextPageToken || null);
          setIsLoading(false);
          setIsRevalidating(true);
        } else {
          setIsLoading(true);
        }
      } else {
        setIsLoading(true);
      }

      try {
        setError(null);

        let res: DrivePageResponse;
        if (section === 'shared' && !currentFolderId) {
          res = await listSharedItems({
            pageSize: 50,
            query: debouncedSearchQuery || undefined,
          });
        } else if (section === 'starred' && !currentFolderId) {
          res = await listStarredItems({
            pageSize: 50,
            query: debouncedSearchQuery || undefined,
          });
        } else if (section === 'trash') {
          res = await listTrashItems({ pageSize: 50 });
        } else {
          res = await listDriveItems({
            parentId: currentFolderId,
            query: debouncedSearchQuery || undefined,
            pageSize: 50,
          });
        }

        const validItems =
          removed.size > 0 ? res.items.filter((i) => !removed.has(i.id)) : res.items;
        setItems(validItems);
        setNextPageToken(res.nextPageToken || null);

        if (!isSearchActive) {
          driveCache.setCachedFolder(section, currentFolderId, undefined, res);
        }
      } catch (err) {
        const msg = (err as Error).message || 'Failed to load Drive items';
        if (itemsRef.current.length > 0) {
          showToast(msg, 'error');
        } else {
          setError(msg);
        }
      } finally {
        setIsLoading(false);
        setIsRevalidating(false);
      }
    },
    [section, currentFolderId, debouncedSearchQuery, showToast]
  );

  const loadMoreItems = useCallback(async () => {
    if (isLoading || isLoadingMore || !nextPageToken) return;

    try {
      setIsLoadingMore(true);

      let res: DrivePageResponse;
      if (section === 'shared' && !currentFolderId) {
        res = await listSharedItems({
          pageSize: 50,
          pageToken: nextPageToken,
          query: debouncedSearchQuery || undefined,
        });
      } else if (section === 'starred' && !currentFolderId) {
        res = await listStarredItems({
          pageSize: 50,
          pageToken: nextPageToken,
          query: debouncedSearchQuery || undefined,
        });
      } else if (section === 'trash') {
        res = await listTrashItems({
          pageSize: 50,
          pageToken: nextPageToken,
        });
      } else {
        res = await listDriveItems({
          parentId: currentFolderId,
          query: debouncedSearchQuery || undefined,
          pageSize: 50,
          pageToken: nextPageToken,
        });
      }

      const removed = removedIdsRef.current;
      setItems((prev) => {
        const existingIds = new Set(prev.map((i) => i.id));
        const filteredNew = res.items.filter(
          (i) => !existingIds.has(i.id) && !removed.has(i.id)
        );
        if (!debouncedSearchQuery) {
          driveCache.appendCachedItems(
            section,
            currentFolderId,
            undefined,
            filteredNew,
            res.nextPageToken
          );
        }
        return [...prev, ...filteredNew];
      });
      setNextPageToken(res.nextPageToken || null);
    } catch (err) {
      console.error('Failed to load more items:', err);
      showToast((err as Error).message || 'Failed to load more items', 'error');
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoading, isLoadingMore, nextPageToken, section, currentFolderId, debouncedSearchQuery, showToast]);

  // Infinite scroll intersection observer: triggers loadMoreItems when scrolling near bottom
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !nextPageToken || isLoading || isLoadingMore) return;

    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            loadMoreItems();
          }
        },
        { rootMargin: '300px' }
      );

      observer.observe(sentinel);
      return () => observer.disconnect();
    }
  }, [nextPageToken, isLoading, isLoadingMore, loadMoreItems]);

  // Forget locally-removed ids whenever the view changes — a trashed file
  // legitimately belongs in the Trash listing. Declared before the load effect
  // so it resets first when both fire on the same commit.
  useEffect(() => {
    removedIdsRef.current = new Set();
    setLoadedThumbnails({});
  }, [section, currentFolderId, debouncedSearchQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);


  const handleOpenFolder = (item: DriveItemView) => {
    const folderId = item.targetId || item.id;
    if (item.isFolder && currentFolderId !== folderId) {
      setCurrentFolderId(folderId);
      setBreadcrumbs((prev) => {
        const existingIdx = prev.findIndex((b) => b.id === folderId);
        if (existingIdx >= 0) {
          return prev.slice(0, existingIdx + 1);
        }
        return [...prev, { id: folderId, name: item.name }];
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
    const name = newFolderName.trim();
    try {
      await createFolder(name, currentFolderId);
      setNewFolderName('');
      setShowNewFolderModal(false);
      showToast(`Folder "${name}" created`);
      driveCache.invalidateFolder(section, currentFolderId);
      loadData(true);
    } catch (err) {
      reportMutationError(err, 'Failed to create folder');
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingItem || !renameValue.trim()) return;
    const name = renameValue.trim();
    try {
      await renameItem(renamingItem.id, name);
      driveCache.updateCachedItem({ ...renamingItem, name });
      setRenamingItem(null);
      showToast(`Renamed to "${name}"`);
      loadData(true);
    } catch (err) {
      reportMutationError(err, 'Failed to rename item');
    }
  };

  // No loadData() in the handlers below. The optimistic removal already leaves the
  // list correct, and re-listing would flip isLoading and swap the whole grid for
  // the "Loading Drive files..." placeholder — a full-page flash on every click.
  // Only the storage bar is refreshed, which re-renders nothing else.

  const handleMoveItem = useCallback(
    async (
      itemToMove: DriveItemView,
      destFolderId?: string,
      destFolderName?: string
    ) => {
      const targetId = itemToMove.targetId || itemToMove.id;
      const targetName = itemToMove.name;
      const folderName = destFolderName || 'destination folder';
      const initialFolderId = currentFolderId;
      const sourceFolderId = currentFolderId || itemToMove.parents?.[0] || 'root';

      const rollback = forgetItem(itemToMove.id, itemsRef.current);
      driveCache.removeCachedItem(itemToMove.id);

      try {
        await moveItem(targetId, destFolderId || '', currentFolderId);
        driveCache.invalidateFolder(section, currentFolderId);
        if (destFolderId) {
          driveCache.invalidateFolder('files', destFolderId);
        }
        showToast(
          `Moved "${targetName}" to ${folderName}`,
          'success',
          {
            durationMs: ACTION_TOAST_DURATION_MS,
            action: {
              label: 'Undo',
              onClick: async () => {
                try {
                  await moveItem(targetId, sourceFolderId, destFolderId || '');
                  driveCache.invalidateFolder(section, currentFolderIdRef.current);
                  if (destFolderId) {
                    driveCache.invalidateFolder('files', destFolderId);
                  }
                  if (sourceFolderId && sourceFolderId !== 'root') {
                    driveCache.invalidateFolder('files', sourceFolderId);
                  }
                  if ((currentFolderIdRef.current || null) === (initialFolderId || null)) {
                    removedIdsRef.current.delete(itemToMove.id);
                    rollback();
                    driveCache.updateCachedItem(itemToMove);
                  } else if (currentFolderIdRef.current === destFolderId) {
                    setItems((prev) => prev.filter((i) => i.id !== itemToMove.id));
                  }
                  showToast(`Moved "${targetName}" back to original location`);
                  refreshStorage();
                } catch (err) {
                  reportMutationError(err, 'Failed to undo move');
                }
              },
            },
          }
        );
        refreshStorage();
      } catch (err) {
        rollback();
        reportMutationError(err, 'Failed to move item');
      }
    },
    [currentFolderId, forgetItem, reportMutationError, section, showToast]
  );



  const handleTrash = async (id: string) => {
    const item = items.find((i) => i.id === id);
    const rollback = forgetItem(id, items);
    driveCache.removeCachedItem(id);
    driveCache.invalidateFolder('trash', undefined);
    try {
      await trashItem(id);
      showToast(item ? `"${item.name}" moved to trash` : 'Moved to trash');
      refreshStorage();
    } catch (err) {
      rollback();
      reportMutationError(err, 'Failed to move to trash');
    }
  };

  const handleRestore = async (id: string) => {
    const item = items.find((i) => i.id === id);
    const rollback = forgetItem(id, items);
    driveCache.removeCachedItem(id);
    driveCache.invalidateFolder('files', undefined);
    driveCache.invalidateFolder('shared', undefined);
    try {
      await restoreItem(id);
      showToast(item ? `"${item.name}" restored` : 'Item restored');
      refreshStorage();
    } catch (err) {
      rollback();
      reportMutationError(err, 'Failed to restore item');
    }
  };

  const handleDeletePermanently = async (id: string) => {
    if (!confirm('Are you sure you want to permanently delete this item?')) return;
    const item = items.find((i) => i.id === id);
    const rollback = forgetItem(id, items);
    driveCache.removeCachedItem(id);
    try {
      await deleteItemPermanently(id);
      showToast(item ? `"${item.name}" deleted permanently` : 'Item deleted permanently');
      refreshStorage();
    } catch (err) {
      rollback();
      reportMutationError(err, 'Failed to delete item');
    }
  };

  const handleEmptyTrash = async () => {
    if (!confirm('Empty all items from Trash? This action cannot be undone.')) return;
    const snapshot = items;
    const emptied = snapshot.length;

    // Clear before awaiting: the request round-trip plus Drive's asynchronous
    // delete would otherwise leave the list looking stuck for seconds.
    snapshot.forEach((i) => removedIdsRef.current.add(i.id));
    setItems([]);
    driveCache.invalidateFolder('trash', undefined);

    try {
      await emptyTrash();
      showToast(emptied > 0 ? `Trash emptied (${emptied} item${emptied === 1 ? '' : 's'})` : 'Trash emptied');
      refreshStorage();
    } catch (err) {
      snapshot.forEach((i) => removedIdsRef.current.delete(i.id));
      setItems(snapshot);
      reportMutationError(err, 'Failed to empty trash');
    }
  };

  const handleToggleStar = async (item: DriveItemView) => {
    const newStarred = !item.starred;
    // Optimistic update in state
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, starred: newStarred } : i))
    );
    driveCache.handleStarToggled(item, newStarred);

    let undoRollback: (() => void) | null = null;
    if (section === 'starred' && !newStarred) {
      undoRollback = forgetItem(item.id, itemsRef.current);
    }

    try {
      await starDriveItem(item.targetId || item.id, newStarred);
      showToast(
        newStarred
          ? `Added "${item.name}" to Starred`
          : `Removed "${item.name}" from Starred`,
        'success',
        section === 'starred' && !newStarred
          ? {
            durationMs: ACTION_TOAST_DURATION_MS,
            action: {
              label: 'Undo',
              onClick: async () => {
                try {
                  await starDriveItem(item.targetId || item.id, true);
                  if (undoRollback) {
                    removedIdsRef.current.delete(item.id);
                    undoRollback();
                  }
                  driveCache.handleStarToggled(item, true);
                  setItems((prev) =>
                    prev.map((i) => (i.id === item.id ? { ...i, starred: true } : i))
                  );
                  showToast(`Restored "${item.name}" to Starred`);
                } catch (err) {
                  reportMutationError(err, 'Failed to undo star');
                }
              },
            },
          }
          : undefined
      );
    } catch (err) {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, starred: item.starred } : i))
      );
      if (undoRollback) {
        removedIdsRef.current.delete(item.id);
        undoRollback();
      }
      driveCache.handleStarToggled(item, Boolean(item.starred));
      reportMutationError(err, `Failed to ${newStarred ? 'star' : 'unstar'} item`);
    }
  };

  const handleMakeCopy = async (item: DriveItemView) => {
    if (item.isFolder) return;
    try {
      showToast(`Creating copy of "${item.name}"...`);
      const copyName = `Copy of ${item.name}`;
      const copy = await copyDriveFile(item.targetId || item.id, {
        name: copyName,
        parentFolderId: currentFolderId,
      });

      setItems((prev) => [copy, ...prev]);
      driveCache.invalidateFolder(section, currentFolderId);
      showToast(`Created "${copy.name}"`, 'success');
      refreshStorage();
    } catch (err) {
      reportMutationError(err, 'Failed to create copy');
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
  const sortedListItems = useMemo(() => [...folders, ...files], [folders, files]);

  // Batch selection states
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState(false);
  const [isBatchMoving, setIsBatchMoving] = useState(false);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);

  // Clear selection on section or folder navigation
  useEffect(() => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  }, [section, currentFolderId]);

  const selectedItems = useMemo(() => {
    if (selectedIds.size === 0) return [];
    return items.filter((item) => selectedIds.has(item.id));
  }, [items, selectedIds]);

  const selectedCount = selectedIds.size;
  const isAllSelected = items.length > 0 && selectedCount === items.length;
  const isPartiallySelected = selectedCount > 0 && !isAllSelected;

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = isPartiallySelected;
    }
  }, [isPartiallySelected]);

  const handleToggleSingleSelection = useCallback(
    (id: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (e?.shiftKey && lastSelectedId) {
        const currentIdx = items.findIndex((i) => i.id === id);
        const lastIdx = items.findIndex((i) => i.id === lastSelectedId);
        if (currentIdx !== -1 && lastIdx !== -1) {
          const start = Math.min(currentIdx, lastIdx);
          const end = Math.max(currentIdx, lastIdx);
          const rangeIds = items.slice(start, end + 1).map((i) => i.id);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const itemId of rangeIds) next.add(itemId);
            return next;
          });
          setLastSelectedId(id);
          return;
        }
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      setLastSelectedId(id);
    },
    [items, lastSelectedId]
  );

  const handleSelectAll = useCallback(() => {
    if (items.length === 0) return;
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
      setLastSelectedId(null);
    } else {
      setSelectedIds(new Set(items.map((i) => i.id)));
      if (items.length > 0) setLastSelectedId(items[0].id);
    }
  }, [items, selectedIds.size]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  }, []);

  const handleBatchToggleStar = async () => {
    if (selectedItems.length === 0 || isBatchProcessing) return;
    const allStarred = selectedItems.every((i) => i.starred);
    const targetStarred = !allStarred;
    const targetIds = selectedItems.map((i) => i.id);

    setItems((prev) =>
      prev.map((item) =>
        selectedIds.has(item.id) ? { ...item, starred: targetStarred } : item
      )
    );
    driveCache.handleBatchStarToggled(selectedItems, targetStarred);

    showToast(
      `${targetStarred ? 'Starred' : 'Removed star from'} ${selectedItems.length} item${selectedItems.length > 1 ? 's' : ''
      }`
    );

    try {
      setIsBatchProcessing(true);
      await batchDriveOperation({
        action: targetStarred ? 'star' : 'unstar',
        itemIds: targetIds,
      });
    } catch (err) {
      setItems((prev) =>
        prev.map((item) =>
          selectedIds.has(item.id) ? { ...item, starred: !targetStarred } : item
        )
      );
      driveCache.handleBatchStarToggled(selectedItems, !targetStarred);
      reportMutationError(err, 'Failed to update star state for selected items');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleBatchTrash = async () => {
    if (selectedItems.length === 0 || isBatchProcessing) return;
    const targetItems = [...selectedItems];
    const targetIds = targetItems.map((i) => i.id);
    const prevItems = [...items];

    setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
    driveCache.removeCachedItems(targetIds);
    handleClearSelection();

    showToast(
      `Moved ${targetItems.length} item${targetItems.length > 1 ? 's' : ''} to trash`,
      'success',
      {
        durationMs: ACTION_TOAST_DURATION_MS,
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await batchDriveOperation({ action: 'restore', itemIds: targetIds });
              setItems(prevItems);
              driveCache.invalidateAll();
              showToast(`Restored ${targetItems.length} items`);
            } catch (err) {
              reportMutationError(err, 'Failed to restore items');
            }
          },
        },
      }
    );

    try {
      setIsBatchProcessing(true);
      await batchDriveOperation({ action: 'trash', itemIds: targetIds });
      refreshStorage();
    } catch (err) {
      setItems(prevItems);
      driveCache.invalidateAll();
      reportMutationError(err, 'Failed to move selected items to trash');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleBatchRestore = async () => {
    if (selectedItems.length === 0 || isBatchProcessing) return;
    const targetItems = [...selectedItems];
    const targetIds = targetItems.map((i) => i.id);
    const prevItems = [...items];

    setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
    driveCache.removeCachedItems(targetIds);
    handleClearSelection();

    showToast(`Restored ${targetItems.length} item${targetItems.length > 1 ? 's' : ''}`);

    try {
      setIsBatchProcessing(true);
      await batchDriveOperation({ action: 'restore', itemIds: targetIds });
      driveCache.invalidateAll();
      refreshStorage();
    } catch (err) {
      setItems(prevItems);
      reportMutationError(err, 'Failed to restore selected items');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleBatchDeletePermanently = async () => {
    if (selectedItems.length === 0 || isBatchProcessing) return;
    const targetItems = [...selectedItems];
    const targetIds = targetItems.map((i) => i.id);
    const prevItems = [...items];

    setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
    driveCache.removeCachedItems(targetIds);
    handleClearSelection();
    setIsConfirmDeleteModalOpen(false);

    showToast(`Deleted ${targetItems.length} item${targetItems.length > 1 ? 's' : ''} permanently`);

    try {
      setIsBatchProcessing(true);
      await batchDriveOperation({ action: 'delete', itemIds: targetIds });
      driveCache.invalidateAll();
      refreshStorage();
    } catch (err) {
      setItems(prevItems);
      reportMutationError(err, 'Failed to delete selected items permanently');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleBatchMakeCopy = async () => {
    if (selectedItems.length === 0 || isBatchProcessing) return;
    const filesToCopy = selectedItems.filter((i) => !i.isFolder);
    if (filesToCopy.length === 0) {
      showToast('Folders cannot be copied', 'error');
      return;
    }

    showToast(`Creating ${filesToCopy.length} cop${filesToCopy.length > 1 ? 'ies' : 'y'}...`);

    try {
      setIsBatchProcessing(true);
      const res = await batchDriveOperation({
        action: 'copy',
        itemIds: filesToCopy.map((i) => i.id),
        destinationFolderId: currentFolderId,
      });

      const copies = res.results
        .filter((r) => r.success && r.item)
        .map((r) => r.item as DriveItemView);

      if (copies.length > 0) {
        setItems((prev) => [...copies, ...prev]);
        driveCache.invalidateFolder(section, currentFolderId, searchQuery);
        showToast(`Created ${copies.length} cop${copies.length > 1 ? 'ies' : 'y'}`, 'success');
        refreshStorage();
      } else {
        showToast('Failed to create copies', 'error');
      }
    } catch (err) {
      reportMutationError(err, 'Failed to copy selected files');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleBatchDownload = () => {
    if (selectedItems.length === 0) return;
    const downloadableFiles = selectedItems.filter((i) => !i.isFolder && i.canDownload !== false);
    if (downloadableFiles.length === 0) {
      showToast('No downloadable files selected', 'error');
      return;
    }

    showToast(`Downloading ${downloadableFiles.length} file${downloadableFiles.length > 1 ? 's' : ''}...`);
    downloadableFiles.forEach((file, index) => {
      setTimeout(() => {
        const link = document.createElement('a');
        link.href = getDownloadUrl(file.targetId || file.id);
        link.download = file.name;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }, index * 300);
    });
  };

  const handleBatchMoved = async (
    movedItems: DriveItemView[],
    destFolderId?: string,
    destFolderName?: string
  ) => {
    const movedIds = new Set(movedItems.map((i) => i.id));
    setItems((prev) => prev.filter((i) => !movedIds.has(i.id)));
    driveCache.removeCachedItems(Array.from(movedIds));
    driveCache.invalidateFolder(section, currentFolderId);
    driveCache.invalidateFolder('files', destFolderId);
    handleClearSelection();

    showToast(
      `Moved ${movedItems.length} item${movedItems.length > 1 ? 's' : ''} to ${destFolderName || 'My Drive'
      }`,
      'success'
    );

    try {
      setIsBatchProcessing(true);
      await batchDriveOperation({
        action: 'move',
        itemIds: Array.from(movedIds),
        destinationFolderId: destFolderId,
        sourceParentFolderId: currentFolderId,
      });
    } catch (err) {
      reportMutationError(err, 'Failed to move some items to destination');
      driveCache.invalidateAll();
      loadData(true);
    } finally {
      setIsBatchProcessing(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable);
      if (isInput) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleSelectAll();
        return;
      }

      if (e.key === 'Escape' && selectedIds.size > 0) {
        e.preventDefault();
        handleClearSelection();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault();
        if (section === 'trash') {
          setIsConfirmDeleteModalOpen(true);
        } else {
          handleBatchTrash();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, items, section, handleSelectAll, handleClearSelection]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header & Storage Quota */}
      <div
        className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-[10px]"
        style={{ marginBottom: '10px' }}
      >
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Google Drive Explorer
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Browse folders, search files, manage permissions, and preview media.
          </p>
        </div>

        {storage ? (
          <div
            className="p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl min-w-[260px]"
            title={
              storage.usageInDrive
                ? `Drive: ${formatStorageUsage(storage.usageInDrive)}, Trash: ${formatStorageUsage(storage.usageInDriveTrash)}, Account Total: ${formatStorageUsage(storage.usage)}`
                : undefined
            }
          >
            <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400 font-medium mb-1.5">
              <span className="inline-flex items-center gap-1.5">
                <img src="/drive.png" alt="Google Drive" className="w-4 h-4 object-contain" />
                <span>Drive Storage</span>
              </span>
              <span>
                {hasLimit
                  ? `${formatStorageUsage(usedStorageBytes)} of ${formatStorageLimit(totalStorageBytes)}`
                  : `${formatStorageUsage(usedStorageBytes)} used`}
              </span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-accent h-1.5 transition-all duration-300"
                style={{ width: `${hasLimit ? storageUsagePct : 100}%` }}
              />
            </div>
          </div>
        ) : storageLoading ? (
          <div
            className="p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl min-w-[260px] animate-pulse"
            aria-label="Loading Drive storage quota"
            data-testid="drive-storage-skeleton"
          >
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded-full bg-slate-200/80 dark:bg-slate-800/80 shrink-0" />
                <div className="h-3 w-20 rounded bg-slate-200/80 dark:bg-slate-800/80" />
              </div>
              <div className="h-3 w-24 rounded bg-slate-200/60 dark:bg-slate-800/60" />
            </div>
            <div className="w-full bg-slate-200/80 dark:bg-slate-800/80 rounded-full h-1.5 overflow-hidden">
              <div className="bg-slate-300/60 dark:bg-slate-700/60 h-1.5 w-1/3 rounded-full" />
            </div>
          </div>
        ) : null}
      </div>

      {/* Navigation Controls: Sections, View Toggle & Action Buttons */}
      <div className="w-full flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-4 p-2.5 sm:p-2 rounded-2xl bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
        <div className="flex items-center justify-start gap-1 w-full sm:w-auto overflow-x-auto scrollbar-none">
          {(['files', 'shared', 'starred', 'trash'] as const).map((s) => (
            <button
              key={s}
              onClick={() => {
                setSection(s);
                setCurrentFolderId(undefined);
                setBreadcrumbs([{ name: s === 'files' ? 'My Drive' : s === 'shared' ? 'Shared with Me' : s === 'starred' ? 'Starred' : 'Trash' }]);
              }}
              className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold capitalize transition-all shrink-0 whitespace-nowrap ${section === s
                ? 'bg-white dark:bg-slate-900 text-accent dark:text-accent-textDark shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
            >
              {s === 'files' ? (
                <svg viewBox="0 -960 960 960" className="w-4 h-4 shrink-0" fill="currentColor" focusable="false">
                  <path d="M376-400H584q53,0 79-45t0-90L558-715q-26-45-78-45t-78,45L298-535q-26,45-0.5,90T376-400Zm104-70L417-580H544L480-470ZM120-280V-800q0-33 23.5-56.5T200-880H760q33,0 56.5,23.5T840-800v520H120ZM200-80q-33,0-56.5-23.5T120-160v-40H840v40q0,33-23.5,56.5T760-80H200Z" />
                </svg>
              ) : s === 'shared' ? (
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" focusable="false">
                  <path d="M15,8c0-1.42-0.5-2.73-1.33-3.76C14.09,4.1,14.53,4,15,4c2.21,0,4,1.79,4,4s-1.79,4-4,4c-0.43,0-0.84-0.09-1.23-0.21 c-0.03-0.01-0.06-0.02-0.1-0.03C14.5,10.73,15,9.42,15,8z M16.66,13.13C18.03,14.06,19,15.32,19,17v3h4v-3 C23,14.82,19.42,13.53,16.66,13.13z M9,4c2.21,0,4,1.79,4,4s-1.79,4-4,4s-4-1.79-4-4S6.79,4,9,4z M9,13c2.67,0,8,1.34,8,4v3H1v-3 C1,14.34,6.33,13,9,13z" />
                </svg>
              ) : s === 'starred' ? (
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" focusable="false" fill="currentColor">
                  <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" focusable="false">
                  <path d="M15,4V3H9v1H4v2h1v13c0,1.1,0.9,2,2,2h10c1.1,0,2-0.9,2-2V6h1V4H15z M11,17H9V8h2V17z M15,17h-2V8h2V17z" />
                </svg>
              )}
              <span>
                {s === 'files' ? (
                  <>
                    <span className="sm:hidden">Drive</span>
                    <span className="hidden sm:inline">My Drive</span>
                  </>
                ) : s === 'shared' ? (
                  <>
                    <span className="sm:hidden">Shared</span>
                    <span className="hidden sm:inline">Shared with Me</span>
                  </>
                ) : s === 'starred' ? (
                  'Starred'
                ) : (
                  'Trash'
                )}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
          {/* Material 3 Segmented Pill Toggle: List vs Grid */}
          <div className="relative inline-flex items-center rounded-full border border-slate-300/80 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 p-0.5 shadow-sm select-none">
            {/* Sliding Material 3 Selection Pill - Hardware accelerated */}
            <span
              className={`absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-sky-100 dark:bg-sky-950/80 shadow-xs pointer-events-none transform-gpu will-change-transform transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${visualViewMode === 'grid' ? 'translate-x-full' : 'translate-x-0'
                }`}
            />
            <button
              type="button"
              onClick={() => handleViewModeChange('list')}
              title="List view"
              aria-label="List view"
              className={`relative z-10 flex-1 flex items-center justify-center min-w-[50px] sm:min-w-[56px] px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-semibold transition-colors duration-150 ${visualViewMode === 'list'
                ? 'text-sky-800 dark:text-sky-200'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
            >
              <span
                className={`inline-flex items-center justify-center overflow-hidden transform-gpu will-change-[max-width,opacity] transition-[max-width,opacity,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${visualViewMode === 'list'
                  ? 'max-w-[14px] opacity-100 mr-1.5 scale-100'
                  : 'max-w-0 opacity-0 mr-0 scale-75 pointer-events-none'
                  }`}
                aria-hidden="true"
              >
                <svg className="w-3.5 h-3.5 stroke-[2.5] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange('grid')}
              title="Grid preview view"
              aria-label="Grid view"
              className={`relative z-10 flex-1 flex items-center justify-center min-w-[50px] sm:min-w-[56px] px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-semibold transition-colors duration-150 ${visualViewMode === 'grid'
                ? 'text-sky-800 dark:text-sky-200'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
            >
              <span
                className={`inline-flex items-center justify-center overflow-hidden transform-gpu will-change-[max-width,opacity] transition-[max-width,opacity,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${visualViewMode === 'grid'
                  ? 'max-w-[14px] opacity-100 mr-1.5 scale-100'
                  : 'max-w-0 opacity-0 mr-0 scale-75 pointer-events-none'
                  }`}
                aria-hidden="true"
              >
                <svg className="w-3.5 h-3.5 stroke-[2.5] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
            </button>
          </div>

          {section === 'files' && (
            <>
              {currentFolderId && (
                <button
                  onClick={() => {
                    const cur = breadcrumbs[breadcrumbs.length - 1];
                    if (cur && cur.id) {
                      setSharingItem({
                        id: cur.id,
                        name: cur.name,
                        mimeType: 'application/vnd.google-apps.folder',
                        isFolder: true,
                        shared: false,
                        trashed: false,
                      });
                    }
                  }}
                  title="Share this folder"
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold shadow-xs transition-colors"
                >
                  <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  <span>Share</span>
                </button>
              )}
              <button
                onClick={() => setShowNewFolderModal(true)}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-sm transition-colors"
              >
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <span>New Folder</span>
              </button>
            </>
          )}

          {section === 'trash' && items.length > 0 && (
            <button
              onClick={handleEmptyTrash}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-sm transition-colors"
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
                className={`hover:text-accent dark:hover:text-accent-textDark truncate max-w-[120px] sm:max-w-[150px] ${idx === breadcrumbs.length - 1 ? 'font-semibold text-slate-900 dark:text-white' : ''
                  }`}
              >
                {b.name}
              </button>
            </React.Fragment>
          ))}

          {/* Refresh Button & SWR Background Sync Indicator */}
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={isLoading || isRevalidating}
            title={isRevalidating ? 'Updating in background...' : 'Refresh folder contents'}
            aria-label="Refresh folder"
            className="ml-1 p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 transition-colors disabled:opacity-50"
          >
            <svg
              className={`w-3.5 h-3.5 ${isRevalidating ? 'animate-spin text-accent' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
          {isRevalidating && (
            <span className="text-[11px] text-accent dark:text-accent-textDark font-medium animate-pulse hidden sm:inline">
              Updating...
            </span>
          )}
        </div>

        {/* Search */}
        {section !== 'trash' && (
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              placeholder={section === 'starred' ? 'Search starred files...' : 'Search files...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-800/50 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
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
        viewMode === 'list' ? (
          /* ======================== LIST VIEW SKELETON ======================== */
          <div
            className="p-4 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl shadow-sm animate-pulse"
            aria-label="Loading Drive files"
            data-testid="drive-loading-skeleton"
          >
            <span className="sr-only">Loading Drive files...</span>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {[...Array(8)].map((_, i) => (
                <div key={`list-skel-${i}`} className="py-3 px-2 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0 pr-4">
                    <div className="w-8 h-8 rounded-lg bg-slate-200/80 dark:bg-slate-800/80 shrink-0" />
                    <div className="space-y-1.5 min-w-0">
                      <div
                        className="h-3.5 rounded bg-slate-200/80 dark:bg-slate-800/80"
                        style={{ width: `${140 + ((i * 37) % 120)}px` }}
                      />
                      <div className="h-2.5 w-28 rounded bg-slate-200/50 dark:bg-slate-800/50" />
                    </div>
                  </div>
                  <div className="w-6 h-6 rounded-full bg-slate-200/50 dark:bg-slate-800/50 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* ======================== GRID VIEW SKELETON ======================== */
          <div className="space-y-6 sm:space-y-8 animate-pulse" aria-label="Loading Drive files" data-testid="drive-loading-skeleton">
            <span className="sr-only">Loading Drive files...</span>

            {/* Folders Skeleton Section */}
            <div>
              <div className="h-3.5 w-24 rounded bg-slate-200 dark:bg-slate-800 mb-2.5 sm:mb-3 ml-1" />
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={`folder-skel-${i}`}
                    className="p-2 sm:p-3.5 rounded-xl sm:rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl flex flex-col justify-between min-h-[82px] sm:min-h-[104px]"
                  >
                    <div className="flex items-center justify-between gap-1 mb-1 sm:mb-2">
                      <div className="w-7 h-7 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-slate-200/80 dark:bg-slate-800/80 shrink-0" />
                      <div className="w-6 h-6 rounded-full bg-slate-200/50 dark:bg-slate-800/50 shrink-0" />
                    </div>
                    <div>
                      <div
                        className="h-3 sm:h-3.5 rounded bg-slate-200/80 dark:bg-slate-800/80"
                        style={{ width: `${60 + ((i * 17) % 30)}%` }}
                      />
                      <div className="h-2 sm:h-2.5 w-16 rounded bg-slate-200/50 dark:bg-slate-800/50 mt-1.5" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Files Skeleton Section */}
            <div>
              <div className="h-3.5 w-20 rounded bg-slate-200 dark:bg-slate-800 mb-2.5 sm:mb-3 ml-1" />
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3.5">
                {[...Array(10)].map((_, i) => (
                  <div
                    key={`file-skel-${i}`}
                    className="rounded-xl sm:rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl shadow-xs overflow-hidden flex flex-col justify-between"
                  >
                    {/* Thumbnail Banner Skeleton */}
                    <div className="relative aspect-video w-full bg-slate-200/70 dark:bg-slate-800/70 flex items-center justify-center border-b border-slate-100 dark:border-slate-800">
                      <div className="w-7 h-7 sm:w-10 sm:h-10 rounded-lg bg-slate-300/50 dark:bg-slate-700/50" />
                    </div>

                    {/* Content Skeleton */}
                    <div className="p-2 sm:p-3.5 flex flex-col justify-between flex-1 min-w-0">
                      <div>
                        <div
                          className="h-3 sm:h-3.5 rounded bg-slate-200/80 dark:bg-slate-800/80 mb-1"
                          style={{ width: `${65 + ((i * 23) % 25)}%` }}
                        />
                        <div className="h-2 sm:h-2.5 w-24 rounded bg-slate-200/50 dark:bg-slate-800/50 mt-1" />
                      </div>

                      {/* Footer Skeleton */}
                      <div className="flex items-center justify-between pt-1.5 sm:pt-2 mt-1.5 sm:mt-2 border-t border-slate-100 dark:border-slate-800/80">
                        <div className="h-2.5 w-10 rounded bg-slate-200/50 dark:bg-slate-800/50" />
                        <div className="w-5 h-5 rounded-full bg-slate-200/50 dark:bg-slate-800/50" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      ) : items.length === 0 ? (
        section === 'trash' ? (
          <div className="py-20 sm:py-28 flex flex-col items-center justify-center text-center select-none animate-fade-in">
            <img
              src="https://ssl.gstatic.com/docs/doclist/images/empty_state_trash_v4.svg"
              alt="Trash is empty"
              className="w-52 sm:w-64 h-auto mb-6 pointer-events-none"
            />
            <p className="text-lg sm:text-xl font-normal text-slate-800 dark:text-slate-200">
              Trash is empty
            </p>
          </div>
        ) : section === 'starred' ? (
          <div className="py-20 sm:py-28 flex flex-col items-center justify-center text-center select-none animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center mb-4 text-amber-500 shadow-xs ring-8 ring-amber-50/50 dark:ring-amber-950/20">
              <svg className="w-8 h-8 fill-amber-400 stroke-amber-500" viewBox="0 0 24 24" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </div>
            <p className="text-lg sm:text-xl font-semibold text-slate-800 dark:text-slate-200">
              No starred files or folders
            </p>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
              Add stars to things that you want to easily find later.
            </p>
          </div>
        ) : (debouncedSearchQuery || searchQuery.trim()) ? (
          <div className="py-16 sm:py-24 flex flex-col items-center justify-center text-center select-none animate-fade-in">
            <img
              src="https://ssl.gstatic.com/docs/doclist/images/empty_state_no_search_results_v6.svg"
              alt="None of your files or folders matched this search"
              className="w-56 sm:w-72 h-auto mb-6 pointer-events-none"
            />
            <p className="text-lg sm:text-xl font-normal text-slate-800 dark:text-slate-200">
              None of your files or folders matched this search
            </p>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-md">
              Try another search, or use search options to find a file by type, owner, and more.
            </p>
          </div>
        ) : (
          <div className="p-16 text-center text-sm text-slate-400 bg-white/40 dark:bg-slate-900/40 rounded-3xl border border-slate-200/80 dark:border-slate-800">
            No files or folders found
          </div>
        )
      ) : (
        <>
          {/* Floating Google Drive Batch Action Toolbar */}
          {selectedCount > 0 && (
            <div
              className="sticky top-16 z-30 mb-4 mx-[10px] p-2.5 sm:px-5 sm:py-3 rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-accent-border shadow-xl shadow-accent/10 flex items-center justify-between gap-2 animate-slide-down"
              style={{ margin: '0px 10px' }}
              data-testid="drive-batch-toolbar"
            >
              {/* Left: Count & Clear */}
              <div className="flex items-center gap-1.5 sm:gap-3">
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="p-1.5 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  title="Clear selection (Esc)"
                  aria-label="Clear selection"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full bg-accent-light dark:bg-accent-dark text-accent dark:text-accent-textDark text-xs font-bold">
                    {selectedCount} selected
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="hidden sm:inline-block text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-accent dark:hover:text-accent-textDark transition-colors"
                >
                  {isAllSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>

              {/* Right: Batch Actions */}
              <div className="flex items-center gap-0 sm:gap-1.5 overflow-x-auto">
                {/* Download (if files in selection) */}
                {selectedItems.some((i) => !i.isFolder && i.canDownload !== false) && (
                  <button
                    type="button"
                    onClick={handleBatchDownload}
                    className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Download selected"
                  >
                    <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span className="hidden md:inline">Download</span>
                  </button>
                )}

                {/* Move To */}
                {section !== 'trash' && (
                  <button
                    type="button"
                    onClick={() => setIsBatchMoving(true)}
                    className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Move selected items"
                  >
                    <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 13l3 3m0 0l-3 3m3-3H9" />
                    </svg>
                    <span className="hidden md:inline">Move</span>
                  </button>
                )}

                {/* Star / Unstar */}
                {section !== 'trash' && (
                  <button
                    type="button"
                    onClick={handleBatchToggleStar}
                    className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title={selectedItems.every((i) => i.starred) ? 'Remove from Starred' : 'Add to Starred'}
                  >
                    <svg
                      className={`w-4 h-4 ${selectedItems.every((i) => i.starred)
                          ? 'text-amber-400 fill-amber-400'
                          : 'text-slate-500'
                        }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                    </svg>
                    <span className="hidden md:inline">
                      {selectedItems.every((i) => i.starred) ? 'Unstar' : 'Star'}
                    </span>
                  </button>
                )}

                {/* Make a copy (files only) */}
                {section !== 'trash' && selectedItems.some((i) => !i.isFolder) && (
                  <button
                    type="button"
                    onClick={handleBatchMakeCopy}
                    className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Make a copy"
                  >
                    <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                    </svg>
                    <span className="hidden md:inline">Make a copy</span>
                  </button>
                )}

                {/* Trash / Restore / Delete */}
                {section === 'trash' ? (
                  <>
                    <button
                      type="button"
                      onClick={handleBatchRestore}
                      className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
                      title="Restore selected"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span className="hidden sm:inline">Restore</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsConfirmDeleteModalOpen(true)}
                      className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                      title="Delete forever"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      <span className="hidden sm:inline">Delete forever</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleBatchTrash}
                    className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                    title="Move to trash (Delete)"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    <span className="hidden sm:inline">Trash</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {viewMode === 'list' ? (
            /* ======================== LIST VIEW ======================== */
            <div className="p-4 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl shadow-sm">


              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {sortedListItems.map((item, idx) => {
                  const isFolder = item.isFolder;
                  const isSelected = selectedIds.has(item.id);
                  const isMenuOpen = activeMenuFileId === item.id;
                  const openUpwards = idx >= Math.max(2, items.length - 2) && items.length > 3;

                  const isDropTarget = isFolder && dropTargetFolderId === item.id;

                  return (
                    <div
                      key={item.id}
                      data-folder-id={isFolder ? item.id : undefined}
                      draggable={false}
                      onPointerEnter={handleItemPointerEnter}
                      onPointerLeave={handleItemPointerLeave}
                      onPointerDown={(e) => handleItemPointerDown(item.id, e)}
                      onPointerMove={handleItemTouchMove}
                      onPointerUp={handleItemPointerUp}
                      onPointerCancel={handleItemPointerUp}
                      onContextMenu={(e) => handleItemContextMenu(item.id, e)}
                      onDragStart={(e) => handleItemDragStart(e, item)}
                      onDragEnd={() => {
                        setDraggedItem(null);
                        setDropTargetFolderId(null);
                      }}
                      onDragOver={(e) => {
                        if (!isFolder) return;
                        e.preventDefault();
                        if (draggedItem && draggedItem.id !== item.id) {
                          setDropTargetFolderId(item.id);
                        }
                      }}
                      onDragLeave={(e) => {
                        if (!isFolder) return;
                        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                        setDropTargetFolderId(null);
                      }}
                      onDrop={(e) => {
                        if (!isFolder) return;
                        e.preventDefault();
                        if (draggedItem && draggedItem.id !== item.id) {
                          handleMoveItem(draggedItem, item.id, item.name);
                        }
                        setDraggedItem(null);
                        setDropTargetFolderId(null);
                      }}
                      onClick={(e) => {
                        if (justFinishedLongPressRef.current) {
                          e.stopPropagation();
                          e.preventDefault();
                          justFinishedLongPressRef.current = false;
                          return;
                        }
                        if (isFolder) handleOpenFolder(item);
                        else handlePreviewFile(item);
                      }}
                      onDoubleClick={() => (isFolder ? handleOpenFolder(item) : handlePreviewFile(item))}
                      className={`py-3 px-2 flex items-center justify-between rounded-xl transition-all group relative cursor-pointer select-none touch-pan-y ${isDropTarget
                          ? 'ring-2 ring-accent bg-accent-light/50 dark:bg-accent-dark/50 scale-[1.01] shadow-md z-20'
                          : isSelected
                            ? 'bg-accent-light dark:bg-accent-dark/30 border-l-4 border-l-accent ring-1 ring-accent/30'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        } ${isMenuOpen ? 'z-30' : 'z-auto'}`}
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-4">
                        <div className="relative shrink-0 flex items-center justify-center">
                          <div className={`w-8 h-8 rounded-lg bg-accent-light dark:bg-accent-dark text-accent dark:text-accent-textDark flex items-center justify-center shrink-0 transition-opacity ${isSelected || selectedCount > 0 ? 'opacity-0' : 'group-hover:opacity-0'}`}>
                            {isFolder ? (
                              <FolderIcon
                                shared={Boolean(item.shared || section === 'shared')}
                                className="w-4 h-4"
                              />
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                              </svg>
                            )}
                          </div>
                          <div
                            className={`absolute inset-0 flex items-center justify-center transition-opacity ${isSelected || selectedCount > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <SelectionCheckbox
                              selected={isSelected}
                              onClick={(e) => handleToggleSingleSelection(item.id, e)}
                            />
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                              {item.name}
                            </p>
                            {(() => {
                              const q = getVideoQuality(item);
                              return q ? (
                                <span className="shrink-0 inline-flex items-center px-1 py-0.5 rounded text-[9px] leading-none font-mono font-bold bg-accent-light dark:bg-accent-dark text-accent dark:text-accent-textDark border border-accent-border">
                                  {q}
                                </span>
                              ) : null;
                            })()}
                          </div>
                          <p className="text-xs text-slate-400">
                            {item.size ? `${(item.size / (1024 * 1024)).toFixed(2)} MiB` : 'Folder'} •{' '}
                            {item.modifiedTime ? new Date(item.modifiedTime).toLocaleDateString() : '—'}
                          </p>
                        </div>
                      </div>

                      {/* Actions: Star toggle + More actions dropdown menu */}
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {section !== 'trash' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleStar(item);
                            }}
                            title={item.starred ? 'Starred' : 'Not starred'}
                            aria-label={item.starred ? 'Starred' : 'Not starred'}
                            className={`p-1 sm:p-1.5 rounded-full transition-all ${item.starred
                                ? 'text-amber-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40 opacity-100'
                                : 'text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 opacity-0 group-hover:opacity-100 focus:opacity-100'
                              }`}
                          >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill={item.starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                            </svg>
                          </button>
                        )}

                        <div className="relative">
                          <button
                            data-actions-button="true"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenuFileId((prev) => (prev === item.id ? null : item.id));
                            }}
                            title="More actions"
                            aria-label="More actions"
                            className={`p-1 sm:p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${isMenuOpen ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 ring-2 ring-accent/20' : ''
                              }`}
                          >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                            </svg>
                          </button>

                          {/* More Actions Dropdown Menu */}
                          <div
                            data-actions-menu="true"
                            className={`absolute right-0 ${openUpwards ? 'bottom-full mb-1 sm:mb-1.5 origin-bottom-right' : 'top-full mt-1 sm:mt-1.5 origin-top-right'
                              } w-40 sm:w-48 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-lg sm:shadow-xl shadow-slate-900/10 dark:shadow-black/40 p-1 sm:p-1.5 z-50 transition-all duration-150 max-h-[min(380px,calc(100vh-120px))] overflow-y-auto ${isMenuOpen
                                ? 'opacity-100 scale-100 pointer-events-auto'
                                : 'opacity-0 scale-95 pointer-events-none'
                              }`}
                          >
                            {section !== 'trash' && (
                              <>
                                <button
                                  onClick={() => {
                                    setActiveMenuFileId(null);
                                    handleToggleStar(item);
                                  }}
                                  title={item.starred ? 'Remove from Starred' : 'Add to Starred'}
                                  className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                >
                                  <svg className={`w-3.5 h-3.5 shrink-0 ${item.starred ? 'text-amber-400 fill-amber-400' : 'text-slate-400'}`} viewBox="0 0 24 24" fill={item.starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                  </svg>
                                  <span>{item.starred ? 'Remove from Starred' : 'Add to Starred'}</span>
                                </button>
                                <button
                                  onClick={() => {
                                    setActiveMenuFileId(null);
                                    setSharingItem(item);
                                  }}
                                  title="Share"
                                  className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                >
                                  <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                                  </svg>
                                  <span>Share</span>
                                </button>

                                <button
                                  onClick={() => {
                                    setActiveMenuFileId(null);
                                    handleCopyItemLink(item);
                                  }}
                                  title="Copy link"
                                  className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                >
                                  <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                  </svg>
                                  <span>Copy link</span>
                                </button>
                              </>
                            )}

                            {isFolder && (
                              <button
                                onClick={() => {
                                  setActiveMenuFileId(null);
                                  handleOpenFolder(item);
                                }}
                                title="Open folder"
                                className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                              >
                                <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                                </svg>
                                <span>Open folder</span>
                              </button>
                            )}

                            {!isFolder && (
                              <>
                                <button
                                  onClick={() => {
                                    setActiveMenuFileId(null);
                                    handlePreviewFile(item);
                                  }}
                                  title="Preview"
                                  className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                >
                                  <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                  <span>Preview</span>
                                </button>

                                <a
                                  href={getDownloadUrl(item.id)}
                                  download={item.name}
                                  title="Download"
                                  onClick={() => setActiveMenuFileId(null)}
                                  className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                >
                                  <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                  </svg>
                                  <span>Download</span>
                                </a>
                              </>
                            )}

                            {(() => {
                              const driveItemUrl =
                                item.webViewLink ||
                                (item.isFolder
                                  ? `https://drive.google.com/drive/folders/${item.targetId || item.id}`
                                  : `https://drive.google.com/file/d/${item.targetId || item.id}/view`);
                              return (
                                <a
                                  href={driveItemUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Open in Drive"
                                  onClick={() => setActiveMenuFileId(null)}
                                  className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                >
                                  <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                  <span>Open in Drive</span>
                                </a>
                              );
                            })()}

                            {section !== 'trash' && !isFolder && (
                              <>
                                {isConvertibleVideo(item) && (
                                  <button
                                    onClick={() => {
                                      setActiveMenuFileId(null);
                                      handleConvertFile(item);
                                    }}
                                    title="Convert Video"
                                    className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                  >
                                    <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                    <span>Convert Video</span>
                                  </button>
                                )}
                                {isConvertibleAudio(item) && !isConvertibleVideo(item) && (
                                  <button
                                    onClick={() => {
                                      setActiveMenuFileId(null);
                                      handleConvertFile(item);
                                    }}
                                    title="Convert Audio"
                                    className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                  >
                                    <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                                    </svg>
                                    <span>Convert Audio</span>
                                  </button>
                                )}
                                {isConvertibleDoc(item) && !isConvertibleVideo(item) && !isConvertibleAudio(item) && (
                                  <button
                                    onClick={() => {
                                      setActiveMenuFileId(null);
                                      handleConvertFile(item);
                                    }}
                                    title="Convert Document"
                                    className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                  >
                                    <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                                    </svg>
                                    <span>Convert Document</span>
                                  </button>
                                )}
                                {isExtractableArchive(item) && (
                                  <button
                                    onClick={() => {
                                      setActiveMenuFileId(null);
                                      setExtractingItem(item);
                                    }}
                                    title="Extract Archive"
                                    className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                  >
                                    <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                                    </svg>
                                    <span>Extract Archive</span>
                                  </button>
                                )}
                              </>
                            )}

                            {section !== 'trash' && (
                              <>
                                <button
                                  onClick={() => {
                                    setActiveMenuFileId(null);
                                    setMovingItem(item);
                                  }}
                                  title="Move"
                                  className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                >
                                  <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 13l3 3m0 0l-3 3m3-3H9" />
                                  </svg>
                                  <span>Move</span>
                                </button>

                                <button
                                  onClick={() => {
                                    setActiveMenuFileId(null);
                                    setRenamingItem(item);
                                    setRenameValue(item.name);
                                  }}
                                  title="Rename"
                                  className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                >
                                  <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                  </svg>
                                  <span>Rename</span>
                                </button>

                                {!isFolder && (
                                  <button
                                    onClick={() => {
                                      setActiveMenuFileId(null);
                                      handleMakeCopy(item);
                                    }}
                                    title="Make a copy"
                                    className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                  >
                                    <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                    <span>Make a copy</span>
                                  </button>
                                )}
                              </>
                            )}

                            <div className="my-0.5 sm:my-1 border-t border-slate-100 dark:border-slate-800" />

                            {section === 'trash' ? (
                              <>
                                <button
                                  onClick={() => {
                                    setActiveMenuFileId(null);
                                    handleRestore(item.id);
                                  }}
                                  title="Restore"
                                  className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors whitespace-nowrap"
                                >
                                  <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                  <span>Restore</span>
                                </button>
                                <button
                                  onClick={() => {
                                    setActiveMenuFileId(null);
                                    handleDeletePermanently(item.id);
                                  }}
                                  title="Delete permanently"
                                  className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors whitespace-nowrap"
                                >
                                  <svg className="w-3.5 h-3.5 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                  <span>Delete permanently</span>
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => {
                                  setActiveMenuFileId(null);
                                  handleTrash(item.id);
                                }}
                                title="Move to trash"
                                className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors whitespace-nowrap"
                              >
                                <svg className="w-3.5 h-3.5 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                <span>Move to trash</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Incremental loading skeleton for List View */}
                {isLoadingMore && (
                  <>
                    {[...Array(5)].map((_, i) => (
                      <div
                        key={`loading-more-list-skel-${i}`}
                        data-testid="loading-more-skeleton"
                        className="py-3 px-2 flex items-center justify-between animate-pulse"
                        aria-label="Loading more items"
                      >
                        <div className="flex items-center gap-3 min-w-0 pr-4">
                          <div className="w-8 h-8 rounded-lg bg-slate-200/80 dark:bg-slate-800/80 shrink-0" />
                          <div className="space-y-1.5 min-w-0">
                            <div
                              className="h-3.5 rounded bg-slate-200/80 dark:bg-slate-800/80"
                              style={{ width: `${140 + ((i * 37) % 120)}px` }}
                            />
                            <div className="h-2.5 w-24 rounded bg-slate-200/50 dark:bg-slate-800/50" />
                          </div>
                        </div>
                        <div className="w-6 h-6 rounded-full bg-slate-200/50 dark:bg-slate-800/50 shrink-0" />
                      </div>
                    ))}
                  </>
                )}
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
                    {folders.map((folder) => {
                      const isSelected = selectedIds.has(folder.id);
                      const isMenuOpen = activeMenuFileId === folder.id;
                      const isDropTarget = dropTargetFolderId === folder.id;
                      const driveFolderUrl =
                        folder.webViewLink ||
                        `https://drive.google.com/drive/folders/${folder.targetId || folder.id}`;

                      return (
                        <div
                          key={folder.id}
                          data-folder-id={folder.id}
                          draggable={false}
                          onPointerEnter={handleItemPointerEnter}
                          onPointerLeave={handleItemPointerLeave}
                          onPointerDown={(e) => handleItemPointerDown(folder.id, e)}
                          onPointerMove={handleItemTouchMove}
                          onPointerUp={handleItemPointerUp}
                          onPointerCancel={handleItemPointerUp}
                          onContextMenu={(e) => handleItemContextMenu(folder.id, e)}
                          onDragStart={(e) => handleItemDragStart(e, folder)}
                          onDragEnd={() => {
                            setDraggedItem(null);
                            setDropTargetFolderId(null);
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (draggedItem && draggedItem.id !== folder.id) {
                              setDropTargetFolderId(folder.id);
                            }
                          }}
                          onDragLeave={(e) => {
                            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                            setDropTargetFolderId(null);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (draggedItem && draggedItem.id !== folder.id) {
                              handleMoveItem(draggedItem, folder.id, folder.name);
                            }
                            setDraggedItem(null);
                            setDropTargetFolderId(null);
                          }}
                          onClick={(e) => {
                            if (justFinishedLongPressRef.current) {
                              e.stopPropagation();
                              e.preventDefault();
                              justFinishedLongPressRef.current = false;
                              return;
                            }
                            handleOpenFolder(folder);
                          }}
                          onDoubleClick={() => handleOpenFolder(folder)}
                          className={`p-2 sm:p-3.5 rounded-xl sm:rounded-2xl border transition-all cursor-pointer group flex flex-col justify-between relative select-none touch-pan-y ${isDropTarget
                              ? 'ring-2 ring-accent scale-[1.03] shadow-lg shadow-accent/20 bg-accent-light/50 dark:bg-accent-dark/50 border-accent z-20'
                              : isSelected
                                ? 'ring-2 ring-accent bg-accent-light dark:bg-accent-dark/40 border-accent shadow-md'
                                : 'border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl hover:bg-white dark:hover:bg-slate-800 hover:border-accent-border shadow-xs hover:shadow-md'
                            } ${isMenuOpen ? 'z-30' : 'hover:z-10'}`}
                        >
                          {/* Selection Checkbox in top-left */}
                          <div className="absolute top-1.5 left-1.5 sm:top-2 sm:left-2 z-20" onClick={(e) => e.stopPropagation()}>
                            <SelectionCheckbox
                              selected={isSelected}
                              onClick={(e) => handleToggleSingleSelection(folder.id, e)}
                              className={isSelected || selectedCount > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                            />
                          </div>

                          <div className="flex items-center justify-between gap-1 mb-1 sm:mb-2">
                            <div className="w-7 h-7 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-accent-light dark:bg-accent-dark text-accent dark:text-accent-textDark flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                              <FolderIcon
                                shared={Boolean(folder.shared || section === 'shared')}
                                className="w-3.5 h-3.5 sm:w-5 sm:h-5"
                              />
                            </div>

                            {/* Folder More actions button & star button */}
                            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                              {section !== 'trash' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleStar(folder);
                                  }}
                                  title={folder.starred ? 'Starred' : 'Not starred'}
                                  aria-label={folder.starred ? 'Starred' : 'Not starred'}
                                  className={`p-1 sm:p-1.5 rounded-full transition-all ${folder.starred
                                      ? 'text-amber-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40 opacity-100'
                                      : 'text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 opacity-0 group-hover:opacity-100 focus:opacity-100'
                                    }`}
                                >
                                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill={folder.starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                  </svg>
                                </button>
                              )}

                              <div className="relative">
                                <button
                                  data-actions-button="true"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuFileId((prev) => (prev === folder.id ? null : folder.id));
                                  }}
                                  title="More actions"
                                  aria-label="More actions"
                                  className={`p-1 sm:p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${isMenuOpen
                                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 ring-2 ring-accent/20'
                                    : ''
                                    }`}
                                >
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                                  </svg>
                                </button>

                                {/* More Actions Dropdown Menu */}
                                <div
                                  data-actions-menu="true"
                                  className={`absolute right-0 top-full mt-1 sm:mt-1.5 w-40 sm:w-48 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-lg sm:shadow-xl shadow-slate-900/10 dark:shadow-black/40 p-1 sm:p-1.5 z-50 transition-all duration-150 origin-top-right max-h-[min(380px,calc(100vh-120px))] overflow-y-auto ${isMenuOpen
                                    ? 'opacity-100 scale-100 pointer-events-auto'
                                    : 'opacity-0 scale-95 pointer-events-none'
                                    }`}
                                >
                                  {section !== 'trash' && (
                                    <>
                                      <button
                                        onClick={() => {
                                          setActiveMenuFileId(null);
                                          handleToggleStar(folder);
                                        }}
                                        title={folder.starred ? 'Remove from Starred' : 'Add to Starred'}
                                        className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                      >
                                        <svg className={`w-3.5 h-3.5 shrink-0 ${folder.starred ? 'text-amber-400 fill-amber-400' : 'text-slate-400'}`} viewBox="0 0 24 24" fill={folder.starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                        </svg>
                                        <span>{folder.starred ? 'Remove from Starred' : 'Add to Starred'}</span>
                                      </button>
                                      <button
                                        onClick={() => {
                                          setActiveMenuFileId(null);
                                          setSharingItem(folder);
                                        }}
                                        title="Share"
                                        className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                      >
                                        <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                                        </svg>
                                        <span>Share</span>
                                      </button>

                                      <button
                                        onClick={() => {
                                          setActiveMenuFileId(null);
                                          handleCopyItemLink(folder);
                                        }}
                                        title="Copy link"
                                        className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                      >
                                        <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                        </svg>
                                        <span>Copy link</span>
                                      </button>
                                    </>
                                  )}

                                  <button
                                    onClick={() => {
                                      setActiveMenuFileId(null);
                                      handleOpenFolder(folder);
                                    }}
                                    title="Open folder"
                                    className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                  >
                                    <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                                    </svg>
                                    <span>Open folder</span>
                                  </button>

                                  <a
                                    href={driveFolderUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Open in Drive"
                                    onClick={() => setActiveMenuFileId(null)}
                                    className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                  >
                                    <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                    <span>Open in Drive</span>
                                  </a>

                                  {section !== 'trash' && (
                                    <>
                                      <button
                                        onClick={() => {
                                          setActiveMenuFileId(null);
                                          setMovingItem(folder);
                                        }}
                                        title="Move"
                                        className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                      >
                                        <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M14 13l3 3m0 0l-3 3m3-3H9" />
                                        </svg>
                                        <span>Move</span>
                                      </button>

                                      <button
                                        onClick={() => {
                                          setActiveMenuFileId(null);
                                          setRenamingItem(folder);
                                          setRenameValue(folder.name);
                                        }}
                                        title="Rename"
                                        className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                      >
                                        <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                        </svg>
                                        <span>Rename</span>
                                      </button>
                                    </>
                                  )}

                                  <div className="my-0.5 sm:my-1 border-t border-slate-100 dark:border-slate-800" />

                                  {section === 'trash' ? (
                                    <>
                                      <button
                                        onClick={() => {
                                          setActiveMenuFileId(null);
                                          handleRestore(folder.id);
                                        }}
                                        title="Restore"
                                        className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors whitespace-nowrap"
                                      >
                                        <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                        <span>Restore</span>
                                      </button>
                                      <button
                                        onClick={() => {
                                          setActiveMenuFileId(null);
                                          handleDeletePermanently(folder.id);
                                        }}
                                        title="Delete permanently"
                                        className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors whitespace-nowrap"
                                      >
                                        <svg className="w-3.5 h-3.5 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                        <span>Delete permanently</span>
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        setActiveMenuFileId(null);
                                        handleTrash(folder.id);
                                      }}
                                      title="Move to trash"
                                      className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors whitespace-nowrap"
                                    >
                                      <svg className="w-3.5 h-3.5 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                      <span>Move to trash</span>
                                    </button>
                                  )}
                                </div>
                              </div>
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
                      );
                    })}

                    {/* Incremental loading skeleton for Folders (when no files loaded yet) */}
                    {isLoadingMore && files.length === 0 && (
                      <>
                        {[...Array(5)].map((_, i) => (
                          <div
                            key={`loading-more-folder-skel-${i}`}
                            data-testid="loading-more-skeleton"
                            className="p-2 sm:p-3.5 rounded-xl sm:rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl flex flex-col justify-between min-h-[82px] sm:min-h-[104px] animate-pulse"
                            aria-label="Loading more items"
                          >
                            <div className="flex items-center justify-between gap-1 mb-1 sm:mb-2">
                              <div className="w-7 h-7 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-slate-200/80 dark:bg-slate-800/80 shrink-0" />
                              <div className="w-6 h-6 rounded-full bg-slate-200/50 dark:bg-slate-800/50 shrink-0" />
                            </div>
                            <div>
                              <div
                                className="h-3 sm:h-3.5 rounded bg-slate-200/80 dark:bg-slate-800/80"
                                style={{ width: `${60 + ((i * 17) % 30)}%` }}
                              />
                              <div className="h-2 sm:h-2.5 w-16 rounded bg-slate-200/50 dark:bg-slate-800/50 mt-1.5" />
                            </div>
                          </div>
                        ))}
                      </>
                    )}
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
                      const isSelected = selectedIds.has(file.id);
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
                          draggable={false}
                          onPointerEnter={handleItemPointerEnter}
                          onPointerLeave={handleItemPointerLeave}
                          onPointerDown={(e) => handleItemPointerDown(file.id, e)}
                          onPointerMove={handleItemTouchMove}
                          onPointerUp={handleItemPointerUp}
                          onPointerCancel={handleItemPointerUp}
                          onContextMenu={(e) => handleItemContextMenu(file.id, e)}
                          onDragStart={(e) => handleItemDragStart(e, file)}
                          onDragEnd={() => {
                            setDraggedItem(null);
                            setDropTargetFolderId(null);
                          }}
                          onClick={(e) => {
                            if (justFinishedLongPressRef.current) {
                              e.stopPropagation();
                              e.preventDefault();
                              justFinishedLongPressRef.current = false;
                              return;
                            }
                            handlePreviewFile(file);
                          }}
                          onDoubleClick={() => handlePreviewFile(file)}
                          className={`rounded-xl sm:rounded-2xl border transition-all flex flex-col justify-between group cursor-pointer relative select-none touch-pan-y ${isSelected
                              ? 'ring-2 ring-accent bg-accent-light dark:bg-accent-dark/40 border-accent shadow-md'
                              : 'border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl shadow-xs hover:shadow-lg hover:border-slate-300 dark:hover:border-slate-700'
                            } ${activeMenuFileId === file.id ? 'z-30' : 'hover:z-10'}`}
                        >
                          {/* Selection Checkbox in top-left */}
                          <div className="absolute top-1.5 left-1.5 sm:top-2 sm:left-2 z-20" onClick={(e) => e.stopPropagation()}>
                            <SelectionCheckbox
                              selected={isSelected}
                              onClick={(e) => handleToggleSingleSelection(file.id, e)}
                              className={isSelected || selectedCount > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                            />
                          </div>

                          {/* File Preview Banner / Thumbnail */}
                          <div className="relative aspect-video w-full bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center overflow-hidden border-b border-slate-100 dark:border-slate-800 rounded-t-xl sm:rounded-t-2xl">
                            {previewUrl ? (
                              <>
                                {!loadedThumbnails[file.id] && (
                                  <div className="absolute inset-0 bg-slate-200/70 dark:bg-slate-800/70 animate-pulse flex items-center justify-center z-0">
                                    <div className="w-7 h-7 sm:w-10 sm:h-10 rounded-lg bg-slate-300/50 dark:bg-slate-700/50" />
                                  </div>
                                )}
                                <img
                                  src={previewUrl}
                                  alt={file.name}
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  onLoad={() => {
                                    setLoadedThumbnails((prev) => ({ ...prev, [file.id]: true }));
                                  }}
                                  onError={(e) => {
                                    if (isImage && e.currentTarget.src !== downloadUrl && !e.currentTarget.src.endsWith(downloadUrl)) {
                                      e.currentTarget.src = downloadUrl;
                                    } else {
                                      setFailedThumbnails((prev) => ({ ...prev, [file.id]: true }));
                                    }
                                  }}
                                  className={`w-full h-full object-cover object-center group-hover:scale-105 transition-all duration-300 relative z-[1] ${loadedThumbnails[file.id] ? 'opacity-100' : 'opacity-0'
                                    }`}
                                />
                              </>
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

                            {/* Video Quality Badge (Top-right, e.g. 720p, 1080p, 4K) */}
                            {(() => {
                              const qualityBadge = getVideoQuality(file);
                              return qualityBadge ? (
                                <div
                                  title={`Quality: ${qualityBadge}`}
                                  className="absolute top-1 right-1 sm:top-2 sm:right-2 px-1 sm:px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-mono font-bold bg-slate-900/70 backdrop-blur-md text-white shadow-xs z-10 flex items-center gap-0.5"
                                >
                                  <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                  <span>{qualityBadge}</span>
                                </div>
                              ) : null;
                            })()}
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
                            <div className="flex items-center justify-between pt-1.5 sm:pt-2 mt-1.5 sm:mt-2 border-t border-slate-100 dark:border-slate-800/80">
                              <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                                {mimeMeta.label}
                              </span>

                              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                {section !== 'trash' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleStar(file);
                                    }}
                                    title={file.starred ? 'Starred' : 'Not starred'}
                                    aria-label={file.starred ? 'Starred' : 'Not starred'}
                                    className={`p-1 sm:p-1.5 rounded-full transition-all ${file.starred
                                        ? 'text-amber-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40 opacity-100'
                                        : 'text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 opacity-0 group-hover:opacity-100 focus:opacity-100'
                                      }`}
                                  >
                                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill={file.starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                    </svg>
                                  </button>
                                )}

                                <div className="relative">
                                  <button
                                    data-actions-button="true"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveMenuFileId((prev) => (prev === file.id ? null : file.id));
                                    }}
                                    title="More actions"
                                    aria-label="More actions"
                                    className={`p-1 sm:p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${activeMenuFileId === file.id ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 ring-2 ring-accent/20' : ''
                                      }`}
                                  >
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                      <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                                    </svg>
                                  </button>

                                  {/* More Actions Dropdown Menu */}
                                  <div
                                    data-actions-menu="true"
                                    className={`absolute right-0 bottom-full mb-1 sm:mb-1.5 w-40 sm:w-48 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-lg sm:shadow-xl shadow-slate-900/10 dark:shadow-black/40 p-1 sm:p-1.5 z-50 transition-all duration-150 origin-bottom-right max-h-[min(380px,calc(100vh-120px))] overflow-y-auto ${activeMenuFileId === file.id
                                      ? 'opacity-100 scale-100 pointer-events-auto'
                                      : 'opacity-0 scale-95 pointer-events-none'
                                      }`}
                                  >
                                    {section !== 'trash' && (
                                      <>
                                        <button
                                          onClick={() => {
                                            setActiveMenuFileId(null);
                                            handleToggleStar(file);
                                          }}
                                          title={file.starred ? 'Remove from Starred' : 'Add to Starred'}
                                          className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                        >
                                          <svg className={`w-3.5 h-3.5 shrink-0 ${file.starred ? 'text-amber-400 fill-amber-400' : 'text-slate-400'}`} viewBox="0 0 24 24" fill={file.starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                          </svg>
                                          <span>{file.starred ? 'Remove from Starred' : 'Add to Starred'}</span>
                                        </button>

                                        <button
                                          onClick={() => {
                                            setActiveMenuFileId(null);
                                            setSharingItem(file);
                                          }}
                                          title="Share"
                                          className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                        >
                                          <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                                          </svg>
                                          <span>Share</span>
                                        </button>

                                        <button
                                          onClick={() => {
                                            setActiveMenuFileId(null);
                                            handleCopyItemLink(file);
                                          }}
                                          title="Copy link"
                                          className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                        >
                                          <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                          </svg>
                                          <span>Copy link</span>
                                        </button>
                                      </>
                                    )}

                                    <button
                                      onClick={() => {
                                        setActiveMenuFileId(null);
                                        handlePreviewFile(file);
                                      }}
                                      title="Preview"
                                      className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                    >
                                      <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                      </svg>
                                      <span>Preview</span>
                                    </button>

                                    <a
                                      href={getDownloadUrl(file.id)}
                                      download={file.name}
                                      title="Download"
                                      onClick={() => setActiveMenuFileId(null)}
                                      className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                    >
                                      <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                      </svg>
                                      <span>Download</span>
                                    </a>

                                    {file.webViewLink && (
                                      <a
                                        href={file.webViewLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title="Open in Drive"
                                        onClick={() => setActiveMenuFileId(null)}
                                        className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                      >
                                        <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                        </svg>
                                        <span>Open in Drive</span>
                                      </a>
                                    )}

                                    {section !== 'trash' && (
                                      <>
                                        {isConvertibleVideo(file) && (
                                          <button
                                            onClick={() => {
                                              setActiveMenuFileId(null);
                                              handleConvertFile(file);
                                            }}
                                            title="Convert Video"
                                            className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                          >
                                            <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                            </svg>
                                            <span>Convert Video</span>
                                          </button>
                                        )}
                                        {isConvertibleAudio(file) && !isConvertibleVideo(file) && (
                                          <button
                                            onClick={() => {
                                              setActiveMenuFileId(null);
                                              handleConvertFile(file);
                                            }}
                                            title="Convert Audio"
                                            className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                          >
                                            <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                                            </svg>
                                            <span>Convert Audio</span>
                                          </button>
                                        )}
                                        {isConvertibleDoc(file) && !isConvertibleVideo(file) && !isConvertibleAudio(file) && (
                                          <button
                                            onClick={() => {
                                              setActiveMenuFileId(null);
                                              handleConvertFile(file);
                                            }}
                                            title="Convert Document"
                                            className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                          >
                                            <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                                            </svg>
                                            <span>Convert Document</span>
                                          </button>
                                        )}

                                        {isExtractableArchive(file) && (
                                          <button
                                            onClick={() => {
                                              setActiveMenuFileId(null);
                                              setExtractingItem(file);
                                            }}
                                            title="Extract Archive"
                                            className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                          >
                                            <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                                            </svg>
                                            <span>Extract Archive</span>
                                          </button>
                                        )}

                                        <button
                                          onClick={() => {
                                            setActiveMenuFileId(null);
                                            setMovingItem(file);
                                          }}
                                          title="Move"
                                          className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                        >
                                          <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M14 13l3 3m0 0l-3 3m3-3H9" />
                                          </svg>
                                          <span>Move</span>
                                        </button>

                                        <button
                                          onClick={() => {
                                            setActiveMenuFileId(null);
                                            setRenamingItem(file);
                                            setRenameValue(file.name);
                                          }}
                                          title="Rename"
                                          className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                        >
                                          <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                          </svg>
                                          <span>Rename</span>
                                        </button>

                                        <button
                                          onClick={() => {
                                            setActiveMenuFileId(null);
                                            handleMakeCopy(file);
                                          }}
                                          title="Make a copy"
                                          className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-accent-light dark:hover:bg-accent-dark hover:text-accent dark:hover:text-accent-textDark transition-colors whitespace-nowrap"
                                        >
                                          <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                          </svg>
                                          <span>Make a copy</span>
                                        </button>
                                      </>
                                    )}

                                    <div className="my-0.5 sm:my-1 border-t border-slate-100 dark:border-slate-800" />

                                    {section === 'trash' ? (
                                      <>
                                        <button
                                          onClick={() => {
                                            setActiveMenuFileId(null);
                                            handleRestore(file.id);
                                          }}
                                          title="Restore"
                                          className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors whitespace-nowrap"
                                        >
                                          <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                          </svg>
                                          <span>Restore</span>
                                        </button>
                                        <button
                                          onClick={() => {
                                            setActiveMenuFileId(null);
                                            handleDeletePermanently(file.id);
                                          }}
                                          title="Delete permanently"
                                          className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors whitespace-nowrap"
                                        >
                                          <svg className="w-3.5 h-3.5 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                          </svg>
                                          <span>Delete permanently</span>
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          setActiveMenuFileId(null);
                                          handleTrash(file.id);
                                        }}
                                        title="Move to trash"
                                        className="w-full flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-left text-[11px] sm:text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors whitespace-nowrap"
                                      >
                                        <svg className="w-3.5 h-3.5 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                        <span>Move to trash</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Incremental loading skeleton for Files */}
                    {isLoadingMore && (
                      <>
                        {[...Array(5)].map((_, i) => (
                          <div
                            key={`loading-more-file-skel-${i}`}
                            data-testid="loading-more-skeleton"
                            className="rounded-xl sm:rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl shadow-xs overflow-hidden flex flex-col justify-between animate-pulse"
                            aria-label="Loading more items"
                          >
                            {/* Thumbnail Banner Skeleton */}
                            <div className="relative aspect-video w-full bg-slate-200/70 dark:bg-slate-800/70 flex items-center justify-center border-b border-slate-100 dark:border-slate-800">
                              <div className="w-7 h-7 sm:w-10 sm:h-10 rounded-lg bg-slate-300/50 dark:bg-slate-700/50" />
                            </div>

                            {/* Content Skeleton */}
                            <div className="p-2 sm:p-3.5 flex flex-col justify-between flex-1 min-w-0">
                              <div>
                                <div
                                  className="h-3 sm:h-3.5 rounded bg-slate-200/80 dark:bg-slate-800/80 mb-1"
                                  style={{ width: `${65 + ((i * 23) % 25)}%` }}
                                />
                                <div className="h-2 sm:h-2.5 w-24 rounded bg-slate-200/50 dark:bg-slate-800/50 mt-1" />
                              </div>

                              {/* Footer Skeleton */}
                              <div className="flex items-center justify-between pt-1.5 sm:pt-2 mt-1.5 sm:mt-2 border-t border-slate-100 dark:border-slate-800/80">
                                <div className="h-2.5 w-10 rounded bg-slate-200/50 dark:bg-slate-800/50" />
                                <div className="w-5 h-5 rounded-full bg-slate-200/50 dark:bg-slate-800/50" />
                              </div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Infinite Scroll Sentinel & Loading Indicator */}
      {!isLoading && items.length > 0 && (
        <div
          ref={loadMoreSentinelRef}
          className="w-full py-4 flex flex-col items-center justify-center min-h-[48px]"
        >
          {isLoadingMore ? (
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 py-3">
              <svg className="w-4 h-4 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Loading more items...</span>
            </div>
          ) : nextPageToken ? (
            <button
              type="button"
              onClick={loadMoreItems}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors shadow-xs flex items-center gap-2"
            >
              <span>Load more items</span>
              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          ) : items.length > 25 ? (
            <p className="text-[11px] text-slate-400 dark:text-slate-500 py-2">
              All {items.length} items loaded
            </p>
          ) : null}
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
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-800/50 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
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
                className="py-2 px-4 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-sm transition-colors"
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
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-800/50 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
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
                className="py-2 px-4 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-sm transition-colors"
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

      {/* Share Modal */}
      <ShareModal
        isOpen={Boolean(sharingItem)}
        item={sharingItem}
        onClose={() => setSharingItem(null)}
        onPermissionChanged={() => {
          loadData();
        }}
      />

      {/* Extract Archive Modal */}
      {extractingItem && (
        <ExtractArchiveModal
          isOpen={Boolean(extractingItem)}
          item={extractingItem}
          currentFolderId={currentFolderId || undefined}
          onClose={() => setExtractingItem(null)}
          onComplete={() => {
            setExtractingItem(null);
            loadData(true);
            showToast('Archive extracted successfully');
          }}
        />
      )}

      {/* Move Item Modal (Single & Batch) */}
      {(movingItem || isBatchMoving) && (
        <MoveItemModal
          isOpen={Boolean(movingItem || isBatchMoving)}
          item={movingItem}
          items={isBatchMoving ? selectedItems : undefined}
          currentFolderId={currentFolderId || undefined}
          onClose={() => {
            setMovingItem(null);
            setIsBatchMoving(false);
          }}
          onMoved={async (moved, destId, destName) => {
            const list = Array.isArray(moved) ? moved : [moved];
            if (isBatchMoving) {
              await handleBatchMoved(list, destId, destName);
            } else if (list[0]) {
              await handleMoveItem(list[0], destId, destName);
            }
          }}
        />
      )}

      {/* Confirm Permanent Delete Modal (Batch) */}
      {isConfirmDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 animate-scale-up">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Delete forever?</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {selectedCount} item{selectedCount > 1 ? 's' : ''} will be deleted forever and cannot be restored.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsConfirmDeleteModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBatchDeletePermanently}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-colors shadow-sm shadow-rose-500/20"
              >
                Delete forever
              </button>
            </div>
          </div>
        </div>
      )}



      {/* Action Toasts */}
      {toasts.length > 0 && (
        <div className="fixed top-4 inset-x-0 z-[60] flex flex-col items-center gap-2 pointer-events-none px-4">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="status"
              aria-live="polite"
              className={`pointer-events-auto flex items-center gap-2.5 sm:gap-3 pl-2.5 pr-2 py-1.5 sm:py-2 rounded-2xl shadow-xl shadow-slate-900/10 dark:shadow-black/50 bg-white/55 dark:bg-slate-900/60 glass-toast border border-white/60 dark:border-white/10 ring-1 ring-black/5 dark:ring-white/5 text-slate-800 dark:text-slate-100 transition-colors w-max max-w-[calc(100vw-2rem)] ${toast.exiting ? 'absolute animate-toast-exit pointer-events-none' : 'relative animate-toast-enter'
                }`}
            >
              {toast.variant === 'success' ? (
                <div className="w-7 h-7 rounded-full bg-accent-light dark:bg-accent-dark text-accent dark:text-accent-textDark flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : (
                <div className="w-7 h-7 rounded-full bg-rose-500/15 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
              )}
              <span
                className={`shrink min-w-0 text-xs sm:text-sm font-medium whitespace-nowrap truncate ${toast.action
                    ? 'max-w-[calc(100vw-11rem)] sm:max-w-sm'
                    : 'max-w-[calc(100vw-7.5rem)] sm:max-w-md'
                  }`}
                title={toast.message}
              >
                {toast.message}
              </span>
              {toast.action && (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const action = toast.action;
                    dismissToast(toast.id);
                    if (action) {
                      await action.onClick();
                    }
                  }}
                  className="shrink-0 ml-1 px-3 py-1 rounded-full text-xs font-semibold bg-black/5 hover:bg-black/10 text-slate-800 dark:bg-white/15 dark:hover:bg-white/25 dark:text-white border border-black/5 dark:border-white/10 active:scale-95 transition-all cursor-pointer"
                >
                  {toast.action.label}
                </button>
              )}
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                title="Dismiss"
                aria-label="Dismiss notification"
                className="shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Floating Back to Top Button */}
      <BackToTop />
    </div>
  );
}

