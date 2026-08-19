import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import {
  IconButton,
  Box,
  Typography,
  Menu,
  MenuItem,
  CircularProgress,
  Tooltip,
  Slider,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DownloadIcon from '@mui/icons-material/Download';
import PrintIcon from '@mui/icons-material/Print';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import RotateRightIcon from '@mui/icons-material/RotateRight';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import PictureInPictureAltIcon from '@mui/icons-material/PictureInPictureAlt';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import SearchIcon from '@mui/icons-material/Search';
import WrapTextIcon from '@mui/icons-material/WrapText';
import TableChartIcon from '@mui/icons-material/TableChart';
import CodeIcon from '@mui/icons-material/Code';
import DescriptionIcon from '@mui/icons-material/Description';
import ImageIcon from '@mui/icons-material/Image';
import VideocamIcon from '@mui/icons-material/Videocam';
import AudioFileIcon from '@mui/icons-material/AudioFile';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import SlideshowIcon from '@mui/icons-material/Slideshow';
import FitScreenIcon from '@mui/icons-material/FitScreen';

import { renderAsync as renderDocx } from 'docx-preview';
import * as XLSX from 'xlsx';

export interface FilePreviewItem {
  id?: string;
  fileId?: string;
  name?: string;
  fileName?: string;
  mimeType?: string;
  size?: number | null;
  modifiedTime?: string | null;
  createdTime?: string | null;
  thumbnailLink?: string | null;
  webViewLink?: string | null;
  fileUrl?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string; picture?: string }>;
  isFolder?: boolean;
}

export interface FilePreviewProps {
  open: boolean;
  onClose: () => void;
  fileId?: string;
  fileName?: string;
  fileUrl?: string;
  mimeType?: string;
  fileSize?: number | null;
  modifiedTime?: string | null;
  createdTime?: string | null;
  thumbnailLink?: string | null;
  webViewLink?: string | null;
  owners?: Array<{ displayName?: string; emailAddress?: string; picture?: string }>;
  files?: FilePreviewItem[];
  currentIndex?: number;
  onNavigate?: (index: number) => void;
}

type PreviewKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'code'
  | 'markdown'
  | 'csv'
  | 'gdoc'
  | 'gsheet'
  | 'gslide'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'office'
  | 'unsupported';

function getFileExtension(filename?: string): string {
  if (!filename) return '';
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

// Kinds that render a paginated document the user may want to zoom. The PDF family
// is separated out because it zooms through the native viewer's URL fragment, while
// the client-rendered kinds zoom with a CSS transform on their wrapper.
const PDF_VIEWER_KINDS: PreviewKind[] = ['pdf', 'gdoc', 'gsheet', 'gslide'];
const DOCUMENT_KINDS: PreviewKind[] = [...PDF_VIEWER_KINDS, 'docx', 'xlsx'];

const isPdfViewerKind = (kind: PreviewKind) => PDF_VIEWER_KINDS.includes(kind);
const isDocumentKind = (kind: PreviewKind) => DOCUMENT_KINDS.includes(kind);

// How long to wait for Drive's presentation iframe before offering slide thumbnails.
const PPTX_FRAME_TIMEOUT_MS = 8000;

// Id of the offscreen iframe used for printing, so repeated prints reuse one element.
const PRINT_FRAME_ID = 'gdu-preview-print-frame';

// Spreadsheet column headers: A..Z, then AA, AB, … The previous `65 + (colIdx % 26)`
// silently relabelled column 27 as "A" again, so wide sheets had duplicate headers.
function columnLabel(index: number): string {
  let label = '';
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    label = String.fromCharCode(65 + (n % 26)) + label;
  }
  return label;
}

function detectPreviewKind(filename?: string, mimeType?: string): PreviewKind {
  const ext = getFileExtension(filename);
  const mime = (mimeType || '').toLowerCase();

  // Google Workspace native types
  if (mime.includes('vnd.google-apps.document')) return 'gdoc';
  if (mime.includes('vnd.google-apps.spreadsheet')) return 'gsheet';
  if (mime.includes('vnd.google-apps.presentation')) return 'gslide';

  // Microsoft Office Word. Only OOXML .docx goes to the native renderer: legacy .doc
  // is an OLE2 compound file that docx-preview cannot parse at all, so routing it
  // here only ever produced an error card. The office fallback offers the things that
  // do work for it — download, and "Open in Google Docs" (Drive converts on open).
  if (ext === 'docx' || mime.includes('wordprocessingml.document')) return 'docx';
  if (ext === 'doc' || mime.includes('msword')) return 'office';

  // Microsoft Office Excel. SheetJS reads .ods too, so it belongs here rather than
  // in the generic office bucket.
  if (ext === 'xlsx' || ext === 'xls' || ext === 'ods' || mime.includes('spreadsheetml.sheet') || mime.includes('ms-excel')) {
    return 'xlsx';
  }

  // Microsoft Office PowerPoint. .odp is deliberately excluded — Drive's preview
  // endpoint does not render OpenDocument presentations, so it would be a guaranteed
  // blank frame.
  if (ext === 'pptx' || ext === 'ppt' || mime.includes('presentationml.presentation') || mime.includes('ms-powerpoint')) {
    return 'pptx';
  }

  // Images
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff'];
  if (mime.startsWith('image/') || imageExts.includes(ext)) return 'image';

  // Videos
  const videoExts = ['mp4', 'webm', 'mkv', 'mov', 'ogg', 'ogv', 'm4v', 'avi', 'wmv'];
  if (mime.startsWith('video/') || videoExts.includes(ext)) return 'video';

  // Audio
  const audioExts = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'wma', 'opus'];
  if (mime.startsWith('audio/') || audioExts.includes(ext)) return 'audio';

  // PDF
  if (mime.includes('pdf') || ext === 'pdf') return 'pdf';

  // CSV / TSV
  if (ext === 'csv' || ext === 'tsv' || mime.includes('csv') || mime.includes('tab-separated-values')) {
    return 'csv';
  }

  // Markdown
  if (ext === 'md' || ext === 'markdown') return 'markdown';

  // Code & text
  const codeExts = [
    'txt', 'js', 'ts', 'jsx', 'tsx', 'json', 'html', 'htm', 'css', 'scss', 'sass', 'less',
    'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'php', 'rb', 'sh', 'bash', 'zsh',
    'yml', 'yaml', 'xml', 'sql', 'log', 'env', 'toml', 'ini', 'bat', 'ps1', 'swift', 'kt', 'kts',
    'dockerfile', 'makefile', 'graphql', 'vue', 'svelte', 'r', 'm', 'dart', 'lua'
  ];
  if (
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('javascript') ||
    mime.includes('xml') ||
    codeExts.includes(ext)
  ) {
    return 'code';
  }

  // Other office types. .ods is handled by the spreadsheet viewer above; .doc and
  // .odp land here because nothing in the app can actually render them.
  if (['odt', 'odp', 'rtf'].includes(ext)) {
    return 'office';
  }

  return 'unsupported';
}

function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Which Google editor can open this file, and at what URL.
 *
 * The MIME tests are ordered most-specific-first and deliberately avoid matching a
 * bare `document`: every OOXML type contains "officedocument" and every OpenDocument
 * type contains "opendocument", so a looser test sent .pptx and .xlsx files to the
 * Google *Docs* editor — a /document/d/{id}/edit URL that only ever errors out for a
 * spreadsheet or a deck.
 */
function getGoogleAppInfo(fileId: string, previewKind: PreviewKind, mimeType?: string, filename?: string) {
  const ext = getFileExtension(filename);
  const mime = (mimeType || '').toLowerCase();

  const isPresentation =
    previewKind === 'gslide' ||
    previewKind === 'pptx' ||
    ['ppt', 'pptx', 'odp'].includes(ext) ||
    mime.includes('presentationml') ||
    mime.includes('powerpoint') ||
    mime.includes('opendocument.presentation') ||
    mime.includes('google-apps.presentation');

  if (isPresentation) {
    return {
      name: 'Google Slides',
      url: `https://docs.google.com/presentation/d/${fileId}/edit`,
      color: 'bg-amber-600 hover:bg-amber-500 text-white',
      badge: 'Slides',
      icon: 'slide',
    };
  }

  const isSpreadsheet =
    previewKind === 'gsheet' ||
    previewKind === 'xlsx' ||
    ['xls', 'xlsx', 'ods', 'csv'].includes(ext) ||
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    mime.includes('csv');

  if (isSpreadsheet) {
    return {
      name: 'Google Sheets',
      url: `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
      color: 'bg-emerald-600 hover:bg-emerald-500 text-white',
      badge: 'Sheet',
      icon: 'sheet',
    };
  }

  const isDocument =
    previewKind === 'gdoc' ||
    previewKind === 'docx' ||
    ['doc', 'docx', 'odt', 'rtf'].includes(ext) ||
    mime.includes('wordprocessingml') ||
    mime.includes('msword') ||
    mime.includes('opendocument.text') ||
    mime.includes('google-apps.document') ||
    mime.includes('rtf');

  if (isDocument) {
    return {
      name: 'Google Docs',
      url: `https://docs.google.com/document/d/${fileId}/edit`,
      color: 'bg-blue-600 hover:bg-blue-500 text-white',
      badge: 'Doc',
      icon: 'doc',
    };
  }

  return null;
}

export default function FilePreview({
  open,
  onClose,
  fileId: propFileId,
  fileName: propFileName,
  fileUrl: propFileUrl,
  mimeType: propMimeType,
  fileSize: propFileSize,
  modifiedTime: propModifiedTime,
  createdTime: propCreatedTime,
  thumbnailLink: propThumbnailLink,
  webViewLink: propWebViewLink,
  owners: propOwners,
  files,
  currentIndex: propCurrentIndex,
  onNavigate,
}: FilePreviewProps) {
  const [activeIndex, setActiveIndex] = useState<number>(propCurrentIndex ?? 0);

  useEffect(() => {
    if (propCurrentIndex !== undefined) {
      setActiveIndex(propCurrentIndex);
    }
  }, [propCurrentIndex]);

  const muiTheme = useTheme();
  const [docDark, setDocDark] = useState<boolean>(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return false;
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const updateTheme = () => {
      setDocDark(document.documentElement.classList.contains('dark'));
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const isDarkMode = (muiTheme?.palette?.mode === 'dark') || docDark;

  const currentItem = files && files.length > 0 && files[activeIndex] ? files[activeIndex] : null;
  const fileId = currentItem?.id || currentItem?.fileId || propFileId || '';
  const fileName = currentItem?.name || currentItem?.fileName || propFileName || 'Unnamed file';
  const mimeType = currentItem?.mimeType || propMimeType;
  const fileSize = currentItem?.size !== undefined ? currentItem.size : propFileSize;
  const modifiedTime = currentItem?.modifiedTime || propModifiedTime;
  const createdTime = currentItem?.createdTime || propCreatedTime;
  const thumbnailLink = currentItem?.thumbnailLink || propThumbnailLink;
  const webViewLink = currentItem?.webViewLink || propWebViewLink || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : '');
  const fileUrl = currentItem?.fileUrl || propFileUrl || (fileId ? `/api/v1/drive/files/${encodeURIComponent(fileId)}/download` : '');
  const owners = currentItem?.owners || propOwners;

  const previewKind = detectPreviewKind(fileName, mimeType);
  const totalFiles = files && files.length > 0 ? files.length : 1;
  const hasMultipleFiles = totalFiles > 1;

  // UI state
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // PDF & Google Workspace export state
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // DOCX rendering state
  const docxContainerRef = useRef<HTMLDivElement | null>(null);
  const [docxError, setDocxError] = useState<string | null>(null);

  // Excel / Spreadsheet state
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [sheetGrid, setSheetGrid] = useState<any[][]>([]);
  const [xlsxSearch, setXlsxSearch] = useState('');
  const [xlsxError, setXlsxError] = useState<string | null>(null);

  // Image viewer state
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Document viewer zoom. Deliberately separate from the image `zoom` above: the two
  // are applied by different mechanisms (a viewer fragment or a wrapper transform vs.
  // an <img> transform), so one shared value would have made the toolbar report a
  // scale it wasn't applying.
  const [docZoom, setDocZoom] = useState(1);
  const [docFitWidth, setDocFitWidth] = useState(false);
  const docScrollRef = useRef<HTMLDivElement | null>(null);
  const docContentRef = useRef<HTMLDivElement | null>(null);

  // PowerPoint state. `pptxFallback` swaps Drive's embedded viewer for the slide
  // thumbnail Drive already generated.
  const [pptxFallback, setPptxFallback] = useState(false);
  const pptxFrameLoadedRef = useRef(false);

  // Code / Text / Markdown / CSV state
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [wrapText, setWrapText] = useState(true);
  const [copiedCode, setCopiedCode] = useState(false);
  const [csvSearch, setCsvSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'preview' | 'raw'>('preview');

  // Video state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isVideoFullscreen, setIsVideoFullscreen] = useState(false);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);

  // Audio state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioVolume, setAudioVolume] = useState(1);
  const [isAudioMuted, setIsAudioMuted] = useState(false);

  // Cleanup old blob URLs
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, [pdfBlobUrl]);

  // Reset transforms and state when switching files
  useEffect(() => {
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(null);
    }
    setLoading(true);
    setZoom(1);
    setRotation(0);
    setPanOffset({ x: 0, y: 0 });
    setDocZoom(1);
    setDocFitWidth(false);
    setPptxFallback(false);
    pptxFrameLoadedRef.current = false;
    setTextContent(null);
    setTextError(null);
    setPdfError(null);
    setDocxError(null);
    setXlsxError(null);
    setWorkbook(null);
    setSheetNames([]);
    setSheetGrid([]);
    setActiveSheetIndex(0);
    setIsPlaying(false);
    setIsAudioPlaying(false);
    setActiveTab('preview');
  }, [fileId]);

  // Main file loading effect based on previewKind
  useEffect(() => {
    if (!open || !fileId) return;

    let isSubscribed = true;
    setLoading(true);

    // 1. Google Workspace Files (.gdoc, .gsheet, .gslide) OR native PDF (.pdf)
    if (previewKind === 'gdoc' || previewKind === 'gsheet' || previewKind === 'gslide' || previewKind === 'pdf') {
      const exportUrl =
        previewKind === 'pdf'
          ? fileUrl
          : `/api/v1/drive/files/${encodeURIComponent(fileId)}/download?exportMimeType=application/pdf`;

      fetch(exportUrl)
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`Failed to export preview (${res.status})`);
          }
          const blob = await res.blob();
          if (isSubscribed) {
            const url = URL.createObjectURL(blob);
            setPdfBlobUrl(url);
            setLoading(false);
          }
        })
        .catch((err) => {
          if (isSubscribed) {
            setPdfError((err as Error).message || 'Unable to load PDF export');
            setLoading(false);
          }
        });

      return () => {
        isSubscribed = false;
      };
    }

    // 2. Word .docx files (client-side render)
    if (previewKind === 'docx') {
      fetch(fileUrl)
        .then(async (res) => {
          if (!res.ok) throw new Error(`Failed to load Word document (${res.status})`);
          const arrayBuffer = await res.arrayBuffer();
          if (isSubscribed && docxContainerRef.current) {
            docxContainerRef.current.innerHTML = '';
            await renderDocx(arrayBuffer, docxContainerRef.current, undefined, {
              inWrapper: true,
              ignoreWidth: false,
              ignoreHeight: false,
              className: 'docx-preview-root',
            });
            setLoading(false);
          }
        })
        .catch((err) => {
          if (isSubscribed) {
            setDocxError((err as Error).message || 'Unable to render Word document');
            setLoading(false);
          }
        });

      return () => {
        isSubscribed = false;
      };
    }

    // 3. Excel .xlsx / .xls files (client-side sheet parser)
    if (previewKind === 'xlsx') {
      fetch(fileUrl)
        .then(async (res) => {
          if (!res.ok) throw new Error(`Failed to load spreadsheet (${res.status})`);
          const arrayBuffer = await res.arrayBuffer();
          if (isSubscribed) {
            const wb = XLSX.read(arrayBuffer, { type: 'array' });
            setWorkbook(wb);
            setSheetNames(wb.SheetNames);
            if (wb.SheetNames.length > 0) {
              const firstSheet = wb.Sheets[wb.SheetNames[0]];
              const rawData = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }) as any[][];
              setSheetGrid(rawData);
            }
            setLoading(false);
          }
        })
        .catch((err) => {
          if (isSubscribed) {
            setXlsxError((err as Error).message || 'Unable to parse spreadsheet');
            setLoading(false);
          }
        });

      return () => {
        isSubscribed = false;
      };
    }

    // 4. Code / Text / Markdown / CSV
    if (previewKind === 'code' || previewKind === 'markdown' || previewKind === 'csv') {
      setTextError(null);
      fetch(fileUrl)
        .then(async (res) => {
          if (!res.ok) throw new Error(`Failed to load text content (${res.status})`);
          const text = await res.text();
          if (isSubscribed) {
            setTextContent(text);
            setLoading(false);
          }
        })
        .catch((err) => {
          if (isSubscribed) {
            setTextError((err as Error).message || 'Unable to load text preview');
            setLoading(false);
          }
        });

      return () => {
        isSubscribed = false;
      };
    }

    // 5. Images
    if (previewKind === 'image') {
      const img = new Image();
      img.src = fileUrl;
      img.onload = () => setLoading(false);
      img.onerror = () => {
        if (thumbnailLink) {
          const highRes = thumbnailLink.replace(/=s\d+/, '=s1600');
          img.src = highRes;
          img.onload = () => setLoading(false);
          img.onerror = () => setLoading(false);
        } else {
          setLoading(false);
        }
      };
      return () => {
        isSubscribed = false;
      };
    }

    // 6. PowerPoint — rendered by Drive in a cross-origin iframe we cannot inspect.
    // Its `onLoad` is the only success signal available, and it does fire for Google's
    // sign-in interstitial too, so this timeout catches the case where nothing loads
    // at all; the visible "Show slide thumbnails" control covers the rest.
    if (previewKind === 'pptx') {
      const fallbackTimer = setTimeout(() => {
        if (isSubscribed && !pptxFrameLoadedRef.current) {
          setPptxFallback(true);
          setLoading(false);
        }
      }, PPTX_FRAME_TIMEOUT_MS);
      return () => {
        isSubscribed = false;
        clearTimeout(fallbackTimer);
      };
    }

    // 7. Anything without its own loader (office, unsupported, video, audio) — those
    // render immediately, so just clear the overlay.
    const timer = setTimeout(() => setLoading(false), 800);
    return () => {
      isSubscribed = false;
      clearTimeout(timer);
    };
  }, [open, fileId, previewKind, fileUrl, thumbnailLink]);

  // Handle Excel Sheet Switching
  const handleSelectSheet = (index: number) => {
    if (!workbook || !sheetNames[index]) return;
    setActiveSheetIndex(index);
    const sheet = workbook.Sheets[sheetNames[index]];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];
    setSheetGrid(rawData);
  };

  // ---------------------------------------------------------------------------
  // Document zoom
  // ---------------------------------------------------------------------------
  const isDocumentViewer = isDocumentKind(previewKind);

  const zoomDocIn = useCallback(() => {
    setDocFitWidth(false);
    setDocZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100));
  }, []);

  const zoomDocOut = useCallback(() => {
    setDocFitWidth(false);
    setDocZoom((z) => Math.max(0.25, Math.round((z - 0.25) * 100) / 100));
  }, []);

  const resetDocZoom = useCallback(() => {
    setDocFitWidth(false);
    setDocZoom(1);
  }, []);

  const fitDocWidth = useCallback(() => {
    setDocFitWidth(true);

    // The PDF family fits through the native viewer's own #view=FitH, so there is
    // nothing to measure. The client-rendered kinds need an explicit scale factor.
    if (isPdfViewerKind(previewKind)) return;

    const container = docScrollRef.current;
    const content = docContentRef.current;
    if (!container || !content) return;

    // Both measurements are pre-transform layout values, so the ratio is correct
    // regardless of the current zoom. They are 0 before layout (and always in
    // jsdom) — scaling by 0 would blank the document, so leave the zoom alone.
    const available = container.clientWidth;
    const natural = content.scrollWidth;
    if (!available || !natural) return;

    setDocZoom(Math.min(4, Math.max(0.25, Math.round((available / natural) * 100) / 100)));
  }, [previewKind]);

  // Native PDF viewers expose no DOM API for zooming — the URL fragment is the only
  // control surface, so the toolbar drives the viewer by re-pointing at the same blob.
  const pdfViewerUrl = useMemo(() => {
    if (!pdfBlobUrl) return null;
    return `${pdfBlobUrl}${docFitWidth ? '#view=FitH' : `#zoom=${Math.round(docZoom * 100)}`}`;
  }, [pdfBlobUrl, docFitWidth, docZoom]);

  // ---------------------------------------------------------------------------
  // Spreadsheet grid derivation
  // ---------------------------------------------------------------------------

  // sheet_to_json returns ragged rows, so the column count has to come from the
  // widest row; deriving it from row 0 truncated every sheet whose first row was
  // shorter than its data.
  const sheetColumnCount = useMemo(
    () => sheetGrid.reduce((max, row) => Math.max(max, row?.length || 0), 0),
    [sheetGrid]
  );

  // Row 1 is pinned so the sheet's own labels survive a search — filtering it away
  // with everything else left the grid with nothing but bare column letters. Each
  // row keeps its true spreadsheet number rather than its position in the filtered
  // list, so a match can be located in the real file.
  const visibleSheetRows = useMemo(() => {
    const needle = xlsxSearch.trim().toLowerCase();
    return sheetGrid
      .map((row, index) => ({ row: row || [], rowNumber: index + 1 }))
      .filter(
        ({ row, rowNumber }) =>
          !needle ||
          rowNumber === 1 ||
          row.some((cell) => String(cell ?? '').toLowerCase().includes(needle))
      );
  }, [sheetGrid, xlsxSearch]);

  // Navigation handlers
  const handlePrev = useCallback(() => {
    if (!files || files.length <= 1) return;
    const nextIdx = (activeIndex - 1 + files.length) % files.length;
    setActiveIndex(nextIdx);
    onNavigate?.(nextIdx);
  }, [activeIndex, files, onNavigate]);

  const handleNext = useCallback(() => {
    if (!files || files.length <= 1) return;
    const nextIdx = (activeIndex + 1) % files.length;
    setActiveIndex(nextIdx);
    onNavigate?.(nextIdx);
  }, [activeIndex, files, onNavigate]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        if (isDocumentViewer) zoomDocIn();
        else setZoom((prev) => Math.min(5, prev + 0.25));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        if (isDocumentViewer) zoomDocOut();
        else setZoom((prev) => Math.max(0.25, prev - 0.25));
      } else if (e.key === '0') {
        e.preventDefault();
        if (isDocumentViewer) {
          resetDocZoom();
        } else {
          setZoom(1);
          setRotation(0);
          setPanOffset({ x: 0, y: 0 });
        }
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        setShowInfo((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose, handlePrev, handleNext, isDocumentViewer, zoomDocIn, zoomDocOut, resetDocZoom]);

  // Pan handlers for image zoom
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setPanOffset({
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (previewKind === 'image') {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      setZoom((prev) => Math.min(5, Math.max(0.25, prev + delta)));
    }
  };

  // Video controls
  const togglePlayVideo = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleVideoSeek = (_: Event, value: number | number[]) => {
    const time = value as number;
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVideoVolume = (_: Event, value: number | number[]) => {
    const vol = (value as number) / 100;
    if (videoRef.current) {
      videoRef.current.volume = vol;
      setVolume(vol);
      setIsMuted(vol === 0);
    }
  };

  const toggleVideoMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleSpeedChange = (rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
      setPlaybackRate(rate);
    }
  };

  const toggleVideoFullscreen = () => {
    if (!videoContainerRef.current) return;
    if (!document.fullscreenElement) {
      videoContainerRef.current.requestFullscreen().catch(() => {});
      setIsVideoFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsVideoFullscreen(false);
    }
  };

  // Audio controls
  const togglePlayAudio = () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play();
      setIsAudioPlaying(true);
    } else {
      audioRef.current.pause();
      setIsAudioPlaying(false);
    }
  };

  const handleAudioSeek = (_: Event, value: number | number[]) => {
    const time = value as number;
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setAudioCurrentTime(time);
    }
  };

  const handleAudioVolume = (_: Event, value: number | number[]) => {
    const vol = (value as number) / 100;
    if (audioRef.current) {
      audioRef.current.volume = vol;
      setAudioVolume(vol);
      setIsAudioMuted(vol === 0);
    }
  };

  const toggleAudioMute = () => {
    if (!audioRef.current) return;
    audioRef.current.muted = !isAudioMuted;
    setIsAudioMuted(!isAudioMuted);
  };

  // Print helper.
  //
  // `window.open(url) + print()` printed a blank page and often nothing at all: the
  // popup has not parsed the PDF by the time print() runs synchronously, and popup
  // blockers reject the window outright. An offscreen iframe fixes both — we own its
  // load event, so print() fires only once the document is really there, and no popup
  // is involved.
  const handlePrint = useCallback(() => {
    if (!pdfBlobUrl) {
      window.print();
      return;
    }

    document.getElementById(PRINT_FRAME_ID)?.remove();

    const frame = document.createElement('iframe');
    frame.id = PRINT_FRAME_ID;
    frame.setAttribute('aria-hidden', 'true');
    // Offscreen rather than display:none — a display:none frame has no layout and
    // several browsers refuse to print it.
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;';
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        // A browser that refuses to print the frame still leaves the PDF viewer's
        // own print control available, so there is nothing useful to report here.
      }
    };
    frame.src = pdfBlobUrl;
    document.body.appendChild(frame);
  }, [pdfBlobUrl]);

  // The print frame outlives handlePrint on purpose (removing it cancels the dialog),
  // so it has to be cleaned up when the preview goes away.
  useEffect(() => {
    return () => {
      document.getElementById(PRINT_FRAME_ID)?.remove();
    };
  }, []);

  // Copy link helper
  const handleCopyLink = () => {
    const link = webViewLink || fileUrl;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs === 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const getTypeIcon = (kind: PreviewKind) => {
    switch (kind) {
      case 'image':
        return <ImageIcon fontSize="small" sx={{ color: '#f43f5e' }} />;
      case 'video':
        return <VideocamIcon fontSize="small" sx={{ color: '#a855f7' }} />;
      case 'audio':
        return <AudioFileIcon fontSize="small" sx={{ color: '#f59e0b' }} />;
      case 'pdf':
        return <PictureAsPdfIcon fontSize="small" sx={{ color: '#ef4444' }} />;
      case 'gdoc':
      case 'docx':
        return <DescriptionIcon fontSize="small" sx={{ color: '#2563eb' }} />;
      case 'gsheet':
      case 'xlsx':
      case 'csv':
        return <TableChartIcon fontSize="small" sx={{ color: '#10b981' }} />;
      case 'gslide':
      case 'pptx':
        return <SlideshowIcon fontSize="small" sx={{ color: '#f59e0b' }} />;
      case 'code':
      case 'markdown':
        return <CodeIcon fontSize="small" sx={{ color: '#6366f1' }} />;
      default:
        return <InsertDriveFileIcon fontSize="small" sx={{ color: '#64748b' }} />;
    }
  };

  const googleAppInfo = getGoogleAppInfo(fileId, previewKind, mimeType, fileName);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-file-name"
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/80 backdrop-blur-md animate-fade-in"
    >
      {/* ========================================================================= */}
      {/* TOP HEADER BAR                                                            */}
      {/* ========================================================================= */}
      <header className="h-14 px-4 bg-white/95 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 z-30 shadow-xs select-none">
        {/* Left: Back / File Info & Badge */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Tooltip title="Back to Drive (Esc)">
            <IconButton size="small" onClick={onClose} sx={{ color: isDarkMode ? '#cbd5e1' : '#475569' }}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-700">
            {getTypeIcon(previewKind)}
          </div>

          <div className="min-w-0">
            <h2 id="preview-file-name" className="text-sm font-bold text-slate-900 dark:text-white truncate" title={fileName}>
              {fileName}
            </h2>
            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              <span>{formatBytes(fileSize)}</span>
              <span>•</span>
              <span className="uppercase font-mono text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold">
                {previewKind}
              </span>
              {hasMultipleFiles && (
                <>
                  <span>•</span>
                  <span>
                    {activeIndex + 1} of {totalFiles}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Center: Contextual Toolbars */}
        <div className="hidden md:flex items-center gap-2">
          {/* Zoom controls for Image */}
          {previewKind === 'image' && (
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl p-0.5 border border-slate-200 dark:border-slate-700">
              <Tooltip title="Zoom out (-)">
                <IconButton size="small" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
                  <ZoomOutIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <span className="text-xs font-mono font-medium px-2 text-slate-700 dark:text-slate-300">
                {Math.round(zoom * 100)}%
              </span>
              <Tooltip title="Zoom in (+)">
                <IconButton size="small" onClick={() => setZoom((z) => Math.min(5, z + 0.25))}>
                  <ZoomInIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Reset (0)">
                <IconButton
                  size="small"
                  onClick={() => {
                    setZoom(1);
                    setRotation(0);
                    setPanOffset({ x: 0, y: 0 });
                  }}
                >
                  <RestartAltIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Rotate 90°">
                <IconButton size="small" onClick={() => setRotation((r) => (r + 90) % 360)}>
                  <RotateRightIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </div>
          )}

          {/* Zoom controls for documents (PDF, Workspace exports, Word, spreadsheets) */}
          {isDocumentViewer && (
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl p-0.5 border border-slate-200 dark:border-slate-700">
              <Tooltip title="Zoom out (-)">
                <IconButton size="small" onClick={zoomDocOut}>
                  <ZoomOutIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <span className="text-xs font-mono font-medium px-2 text-slate-700 dark:text-slate-300 min-w-[3.5rem] text-center">
                {docFitWidth ? 'Fit' : `${Math.round(docZoom * 100)}%`}
              </span>
              <Tooltip title="Zoom in (+)">
                <IconButton size="small" onClick={zoomDocIn}>
                  <ZoomInIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Fit width">
                <IconButton
                  size="small"
                  onClick={fitDocWidth}
                  sx={{
                    color: docFitWidth ? '#6366f1' : isDarkMode ? '#cbd5e1' : '#475569',
                    bgcolor: docFitWidth ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                  }}
                >
                  <FitScreenIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Reset (0)">
                <IconButton size="small" onClick={resetDocZoom}>
                  <RestartAltIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </div>
          )}

          {/* Text/Code Wrap & Copy Toggle */}
          {(previewKind === 'code' || previewKind === 'markdown') && (
            <>
              <Tooltip title={wrapText ? 'Disable line wrap' : 'Enable line wrap'}>
                <IconButton
                  size="small"
                  onClick={() => setWrapText((w) => !w)}
                  sx={{
                    color: wrapText ? '#6366f1' : isDarkMode ? '#cbd5e1' : '#475569',
                    bgcolor: wrapText ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                  }}
                >
                  <WrapTextIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              <Tooltip title={copiedCode ? 'Copied!' : 'Copy text'}>
                <IconButton
                  size="small"
                  onClick={() => {
                    if (textContent) {
                      navigator.clipboard.writeText(textContent);
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 2000);
                    }
                  }}
                  sx={{ color: copiedCode ? '#10b981' : isDarkMode ? '#cbd5e1' : '#475569' }}
                >
                  {copiedCode ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                </IconButton>
              </Tooltip>

              {previewKind === 'markdown' && (
                <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700 text-xs">
                  <button
                    onClick={() => setActiveTab('preview')}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      activeTab === 'preview'
                        ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => setActiveTab('raw')}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      activeTab === 'raw'
                        ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Raw
                  </button>
                </div>
              )}
            </>
          )}

          {/* Excel Search / Filter */}
          {previewKind === 'xlsx' && (
            <div className="flex items-center gap-1.5 px-2 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 py-0.5">
              <SearchIcon fontSize="small" sx={{ color: isDarkMode ? '#94a3b8' : '#64748b' }} />
              <input
                type="text"
                placeholder="Search spreadsheet cells..."
                value={xlsxSearch}
                onChange={(e) => setXlsxSearch(e.target.value)}
                className="bg-transparent text-xs text-slate-800 dark:text-slate-200 px-1 py-0.5 focus:outline-none w-36 lg:w-56"
              />
            </div>
          )}

          {/* Print button */}
          {(isDocumentViewer ||
            previewKind === 'image' ||
            previewKind === 'code' ||
            previewKind === 'markdown' ||
            previewKind === 'csv') && (
            <Tooltip title="Print Document">
              <IconButton size="small" onClick={handlePrint} sx={{ color: isDarkMode ? '#cbd5e1' : '#475569' }}>
                <PrintIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </div>

        {/* Right: Google Suite Primary Button + Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Primary "Open in Google Suite" Action Button */}
          {googleAppInfo && (
            <a
              href={googleAppInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-xs transition-all hover:scale-105 active:scale-95 ${googleAppInfo.color}`}
            >
              <span>{googleAppInfo.name}</span>
              <OpenInNewIcon sx={{ fontSize: 14 }} />
            </a>
          )}

          {/* Download Action */}
          <a
            href={fileUrl}
            download={fileName}
            title="Download file"
            className="p-1.5 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800 transition-colors flex items-center justify-center"
          >
            <DownloadIcon fontSize="small" />
          </a>

          {/* Info Details Toggle */}
          <Tooltip title="File details (i)">
            <IconButton
              size="small"
              onClick={() => setShowInfo((s) => !s)}
              sx={{
                color: showInfo ? '#38bdf8' : isDarkMode ? '#94a3b8' : '#64748b',
                bgcolor: showInfo ? (isDarkMode ? 'rgba(56, 189, 248, 0.1)' : 'rgba(56, 189, 248, 0.12)') : 'transparent',
              }}
            >
              <InfoOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {/* Close Button */}
          <IconButton size="small" onClick={onClose} title="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* MAIN PREVIEW STAGE + SLIDING DETAILS DRAWER                              */}
      {/* ========================================================================= */}
      <div className="relative flex-1 flex overflow-hidden bg-slate-100 dark:bg-slate-950">
        {/* Navigation Chevrons */}
        {hasMultipleFiles && (
          <>
            <button
              onClick={handlePrev}
              title="Previous file (←)"
              aria-label="Previous file"
              className="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-white/90 hover:bg-white text-slate-700 hover:text-slate-900 border border-slate-200 shadow-xl dark:bg-slate-900/80 dark:hover:bg-slate-800 dark:text-slate-300 dark:hover:text-white dark:border-slate-700/80 flex items-center justify-center backdrop-blur-md transition-all hover:scale-110 active:scale-95"
            >
              <NavigateBeforeIcon fontSize="medium" />
            </button>

            <button
              onClick={handleNext}
              title="Next file (→)"
              aria-label="Next file"
              className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-white/90 hover:bg-white text-slate-700 hover:text-slate-900 border border-slate-200 shadow-xl dark:bg-slate-900/80 dark:hover:bg-slate-800 dark:text-slate-300 dark:hover:text-white dark:border-slate-700/80 flex items-center justify-center backdrop-blur-md transition-all hover:scale-110 active:scale-95"
              style={{ right: showInfo ? '340px' : '16px' }}
            >
              <NavigateNextIcon fontSize="medium" />
            </button>
          </>
        )}

        {/* Central Viewport Content Area */}
        <main
          className="flex-1 relative flex items-center justify-center overflow-hidden p-2 sm:p-4"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
        >
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100/70 dark:bg-slate-950/60 backdrop-blur-xs z-10">
              <CircularProgress size={44} sx={{ color: '#6366f1' }} />
              <p className="mt-3 text-xs text-slate-600 dark:text-slate-400 font-medium">
                {previewKind === 'gdoc' || previewKind === 'gsheet' || previewKind === 'gslide'
                  ? 'Converting document via Google Suite...'
                  : 'Loading preview...'}
              </p>
            </div>
          )}

          {/* ======================= IMAGE VIEWER ======================= */}
          {previewKind === 'image' && (
            <div className="w-full h-full flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing">
              <img
                src={fileUrl}
                alt={fileName}
                referrerPolicy="no-referrer"
                draggable={false}
                onError={(e) => {
                  if (thumbnailLink && e.currentTarget.src !== thumbnailLink.replace(/=s\d+/, '=s1600')) {
                    e.currentTarget.src = thumbnailLink.replace(/=s\d+/, '=s1600');
                  }
                }}
                style={{
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                  transition: isPanning ? 'none' : 'transform 0.15s ease-out',
                  maxWidth: '90%',
                  maxHeight: '90%',
                  objectFit: 'contain',
                }}
                className="select-none rounded-xl shadow-2xl"
              />
            </div>
          )}

          {/* ======================= GOOGLE DOCS / SHEETS / SLIDES & PDF VIEWER ======================= */}
          {(previewKind === 'pdf' || previewKind === 'gdoc' || previewKind === 'gsheet' || previewKind === 'gslide') && (
            <div className="w-full h-full max-w-6xl rounded-2xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
              {pdfError ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                  <PictureAsPdfIcon sx={{ fontSize: 56, color: '#ef4444', mb: 2 }} />
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">
                    Unable to generate in-app PDF preview
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mb-6">{pdfError}</p>
                  {googleAppInfo && (
                    <a
                      href={googleAppInfo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg flex items-center gap-2"
                    >
                      <span>Open in {googleAppInfo.name}</span>
                      <OpenInNewIcon fontSize="small" />
                    </a>
                  )}
                </div>
              ) : pdfViewerUrl ? (
                <object
                  data={pdfViewerUrl}
                  type="application/pdf"
                  className="w-full h-full border-none rounded-2xl"
                  title={fileName}
                >
                  <iframe
                    src={pdfViewerUrl}
                    title={fileName}
                    className="w-full h-full border-none rounded-2xl"
                  />
                </object>
              ) : null}
            </div>
          )}

          {/* ======================= WORD (.DOCX) NATIVE VIEWER ======================= */}
          {previewKind === 'docx' && (
            <div
              ref={docScrollRef}
              className="w-full h-full max-w-5xl bg-slate-200 dark:bg-slate-950 rounded-2xl border border-slate-300 dark:border-slate-800 shadow-2xl overflow-auto p-4 sm:p-8 flex justify-center"
            >
              {docxError ? (
                <div className="my-auto text-center p-8">
                  <DescriptionIcon sx={{ fontSize: 56, color: '#3b82f6', mb: 2 }} />
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">
                    Unable to preview Word document
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">{docxError}</p>
                  {googleAppInfo && (
                    <a
                      href={googleAppInfo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg inline-flex items-center gap-2"
                    >
                      <span>Open in Google Docs</span>
                      <OpenInNewIcon fontSize="small" />
                    </a>
                  )}
                </div>
              ) : (
                <div
                  ref={docContentRef}
                  className="w-full max-w-3xl"
                  style={{
                    transform: `scale(${docZoom})`,
                    transformOrigin: 'top center',
                    transition: 'transform 0.15s ease-out',
                  }}
                >
                  <div
                    ref={docxContainerRef}
                    className="w-full bg-white text-slate-900 shadow-xl rounded-sm p-8 sm:p-12 font-serif leading-relaxed"
                    style={{ minHeight: '1000px' }}
                  />
                </div>
              )}
            </div>
          )}

          {/* ======================= EXCEL (.XLSX / .XLS) SPREADSHEET VIEWER ======================= */}
          {previewKind === 'xlsx' && (
            <div className="w-full h-full max-w-6xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden">
              {xlsxError ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                  <TableChartIcon sx={{ fontSize: 56, color: '#10b981', mb: 2 }} />
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">
                    Unable to parse spreadsheet
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">{xlsxError}</p>
                  {googleAppInfo && (
                    <a
                      href={googleAppInfo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg inline-flex items-center gap-2"
                    >
                      <span>Open in Google Sheets</span>
                      <OpenInNewIcon fontSize="small" />
                    </a>
                  )}
                </div>
              ) : (
                <>
                  {/* Top Sheet Tabs Bar */}
                  {sheetNames.length > 1 && (
                    <div className="flex items-center gap-1 px-4 py-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
                      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mr-2 uppercase">Sheets:</span>
                      {sheetNames.map((name, idx) => (
                        <button
                          key={name}
                          onClick={() => handleSelectSheet(idx)}
                          className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                            activeSheetIndex === idx
                              ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Spreadsheet Grid View */}
                  <div ref={docScrollRef} className="flex-1 overflow-auto">
                    <div
                      ref={docContentRef}
                      style={{
                        transform: `scale(${docZoom})`,
                        transformOrigin: 'top left',
                        transition: 'transform 0.15s ease-out',
                      }}
                    >
                      <table className="w-full text-left text-xs border-collapse font-mono">
                        <thead className="bg-slate-100 dark:bg-slate-950 sticky top-0 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold z-10">
                          <tr>
                            <th className="px-3 py-2 border-r border-slate-200 dark:border-slate-800 w-12 text-center text-slate-400 dark:text-slate-500">
                              #
                            </th>
                            {Array.from({ length: sheetColumnCount }, (_, colIdx) => (
                              <th
                                key={colIdx}
                                className="px-3 py-2 border-r border-slate-200 dark:border-slate-800 whitespace-nowrap text-center"
                              >
                                {columnLabel(colIdx)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {visibleSheetRows.map(({ row, rowNumber }) => (
                            <tr key={rowNumber} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                              <td className="px-3 py-1.5 border-r border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 text-center select-none font-semibold">
                                {rowNumber}
                              </td>
                              {Array.from({ length: sheetColumnCount }, (_, colIdx) => {
                                const text = String(row[colIdx] ?? '');
                                return (
                                  <td
                                    key={colIdx}
                                    className="px-3 py-1.5 border-r border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 whitespace-nowrap max-w-xs truncate"
                                    title={text}
                                  >
                                    {text}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ======================= POWERPOINT (.PPTX) VIEWER ======================= */}
          {previewKind === 'pptx' && (
            <div className="w-full h-full max-w-5xl rounded-2xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
              {pptxFallback ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-5 overflow-auto p-6 text-center">
                  <SlideshowIcon sx={{ fontSize: 48, color: '#f59e0b' }} />
                  {thumbnailLink ? (
                    <>
                      <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md">
                        Showing the slide thumbnail Google Drive generated for this presentation. Open
                        it in Google Slides to page through every slide.
                      </p>
                      <img
                        src={thumbnailLink.replace(/=s\d+/, '=s1600')}
                        alt={`First slide of ${fileName}`}
                        referrerPolicy="no-referrer"
                        className="max-w-full rounded-xl shadow-xl border border-slate-200 dark:border-slate-700"
                      />
                    </>
                  ) : (
                    <>
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                        Unable to preview this presentation
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
                        Google Drive did not return a preview or a slide thumbnail for this file. Open
                        it in Google Slides, or download it to view the slides locally.
                      </p>
                    </>
                  )}
                  <div className="flex items-center gap-3">
                    {googleAppInfo && (
                      <a
                        href={googleAppInfo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-lg inline-flex items-center gap-2"
                      >
                        <span>Open in {googleAppInfo.name}</span>
                        <OpenInNewIcon fontSize="small" />
                      </a>
                    )}
                    <a
                      href={fileUrl}
                      download={fileName}
                      className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold border border-slate-200 dark:border-slate-700 inline-flex items-center gap-1.5"
                    >
                      <DownloadIcon fontSize="small" />
                      <span>Download</span>
                    </a>
                  </div>
                </div>
              ) : (
                <>
                  {/* Binary presentations live at the /file/d/ preview endpoint. The
                      /presentation/d/ URL only serves native Google Slides, so it
                      rendered an error page for every uploaded .pptx. */}
                  <iframe
                    src={`https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`}
                    title={fileName}
                    className="w-full flex-1 border-none"
                    allow="autoplay; encrypted-media"
                    onLoad={() => {
                      pptxFrameLoadedRef.current = true;
                      setLoading(false);
                    }}
                  />
                  {/* Drive's viewer can load a sign-in interstitial instead of the
                      slides, and nothing about that is visible to us from outside the
                      frame — so the fallback has to be reachable by hand. */}
                  <button
                    type="button"
                    onClick={() => setPptxFallback(true)}
                    className="shrink-0 px-4 py-2 text-[11px] font-medium text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/70 border-t border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Slides not showing? Show slide thumbnails
                  </button>
                </>
              )}
            </div>
          )}

          {/* ======================= VIDEO VIEWER ======================= */}
          {previewKind === 'video' && (
            <div ref={videoContainerRef} className="relative w-full max-w-5xl rounded-2xl overflow-hidden bg-black shadow-2xl flex items-center justify-center group">
              <video
                ref={videoRef}
                src={fileUrl}
                playsInline
                onTimeUpdate={() => {
                  if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
                }}
                onLoadedMetadata={() => {
                  if (videoRef.current) setDuration(videoRef.current.duration);
                  setLoading(false);
                }}
                className="max-h-[75vh] w-auto mx-auto object-contain cursor-pointer"
                onClick={togglePlayVideo}
              />
            </div>
          )}

          {/* ======================= AUDIO VIEWER ======================= */}
          {previewKind === 'audio' && (
            <div className="w-full max-w-md bg-white/95 dark:bg-slate-900/90 rounded-3xl border border-slate-200 dark:border-slate-800 backdrop-blur-2xl shadow-2xl p-6 sm:p-8 flex flex-col items-center">
              <audio
                ref={audioRef}
                src={fileUrl}
                onTimeUpdate={() => {
                  if (audioRef.current) setAudioCurrentTime(audioRef.current.currentTime);
                }}
                onLoadedMetadata={() => {
                  if (audioRef.current) setAudioDuration(audioRef.current.duration);
                  setLoading(false);
                }}
              />
              <div className="w-24 h-24 rounded-3xl bg-amber-500/10 flex items-center justify-center mb-6 border border-amber-500/20 shadow-inner">
                <AudioFileIcon sx={{ fontSize: 52, color: '#f59e0b' }} />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 text-center truncate max-w-full px-2" title={fileName}>
                {fileName}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">{formatBytes(fileSize)}</p>
              <div className="w-full mt-6">
                <Slider
                  size="small"
                  value={audioCurrentTime}
                  min={0}
                  max={audioDuration || 100}
                  onChange={handleAudioSeek}
                  sx={{ color: '#f59e0b', height: 4 }}
                />
                <div className="flex justify-between text-xs font-mono text-slate-500 dark:text-slate-400 mt-1">
                  <span>{formatTime(audioCurrentTime)}</span>
                  <span>{formatTime(audioDuration)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between w-full mt-4">
                <IconButton size="small" onClick={toggleAudioMute} sx={{ color: isDarkMode ? '#cbd5e1' : '#475569' }}>
                  {isAudioMuted || audioVolume === 0 ? <VolumeOffIcon fontSize="small" /> : <VolumeUpIcon fontSize="small" />}
                </IconButton>
                <button
                  onClick={togglePlayAudio}
                  aria-label="Play audio"
                  className="w-14 h-14 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95"
                >
                  {isAudioPlaying ? <PauseIcon sx={{ fontSize: 32 }} /> : <PlayArrowIcon sx={{ fontSize: 32 }} />}
                </button>
                <a
                  href={fileUrl}
                  download={fileName}
                  className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                >
                  <DownloadIcon fontSize="small" />
                </a>
              </div>
            </div>
          )}

          {/* ======================= CODE / TEXT VIEWER ======================= */}
          {(previewKind === 'code' || (previewKind === 'markdown' && activeTab === 'raw')) && (
            <div className="w-full h-full max-w-5xl bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200 dark:border-slate-800 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden">
              {textError ? (
                <div className="p-8 text-center text-rose-500 dark:text-rose-400 text-sm">{textError}</div>
              ) : textContent !== null ? (
                <div className="flex-1 overflow-auto p-4 font-mono text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
                  <table className="w-full border-collapse">
                    <tbody>
                      {textContent.split('\n').map((line, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="pr-4 py-0.5 text-right text-slate-400 dark:text-slate-500 select-none border-r border-slate-200 dark:border-slate-800 w-12 align-top text-[11px]">
                            {idx + 1}
                          </td>
                          <td className={`pl-4 py-0.5 ${wrapText ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}>
                            {line || ' '}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          )}

          {/* ======================= MARKDOWN PREVIEW ======================= */}
          {previewKind === 'markdown' && activeTab === 'preview' && (
            <div className="w-full h-full max-w-4xl bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200 dark:border-slate-800 backdrop-blur-xl shadow-2xl p-6 sm:p-10 overflow-auto prose dark:prose-invert max-w-none text-slate-800 dark:text-slate-200 text-sm leading-relaxed">
              {textContent ? (
                <div className="space-y-4">
                  {textContent.split('\n\n').map((block, i) => {
                    if (block.startsWith('# ')) {
                      return <h1 key={i} className="text-2xl font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-2">{block.replace('# ', '')}</h1>;
                    }
                    if (block.startsWith('## ')) {
                      return <h2 key={i} className="text-xl font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-1 mt-4">{block.replace('## ', '')}</h2>;
                    }
                    if (block.startsWith('### ')) {
                      return <h3 key={i} className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-3">{block.replace('### ', '')}</h3>;
                    }
                    if (block.startsWith('- ') || block.startsWith('* ')) {
                      return (
                        <ul key={i} className="list-disc list-inside space-y-1 text-slate-700 dark:text-slate-300">
                          {block.split('\n').map((item, j) => (
                            <li key={j}>{item.replace(/^[-*]\s+/, '')}</li>
                          ))}
                        </ul>
                      );
                    }
                    if (block.startsWith('```')) {
                      const codeLines = block.replace(/```[a-z]*\n?/g, '');
                      return (
                        <pre key={i} className="p-4 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 font-mono text-xs text-indigo-700 dark:text-indigo-300 overflow-x-auto">
                          {codeLines}
                        </pre>
                      );
                    }
                    return <p key={i} className="text-slate-700 dark:text-slate-300">{block}</p>;
                  })}
                </div>
              ) : null}
            </div>
          )}

          {/* ======================= CSV / TSV VIEWER ======================= */}
          {previewKind === 'csv' && (
            <div className="w-full h-full max-w-6xl bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200 dark:border-slate-800 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden">
              <div className="flex-1 overflow-auto">
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {textContent
                      ?.split('\n')
                      .filter((line) => line.trim().length > 0)
                      .map((row, rowIdx) => (
                        <tr key={rowIdx} className={rowIdx === 0 ? 'bg-slate-100 dark:bg-slate-950 font-bold' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}>
                          <td className="px-3 py-1.5 border-r border-slate-200 dark:border-slate-800 text-slate-400 text-center w-12 select-none">
                            {rowIdx + 1}
                          </td>
                          {row.split(',').map((cell, colIdx) => (
                            <td key={colIdx} className="px-3 py-1.5 border-r border-slate-200 dark:border-slate-800 whitespace-nowrap">
                              {cell.replace(/^["']|["']$/g, '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ======================= UNSUPPORTED / BINARY FALLBACK ======================= */}
          {(previewKind === 'unsupported' || previewKind === 'office') && (
            <div className="p-8 sm:p-12 rounded-3xl bg-white/95 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 backdrop-blur-2xl shadow-2xl text-center max-w-md flex flex-col items-center">
              <div className="w-20 h-20 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-5 border border-indigo-500/20">
                <InsertDriveFileIcon sx={{ fontSize: 44 }} />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate max-w-full px-2" title={fileName}>
                {fileName}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {formatBytes(fileSize)} • {mimeType || 'Binary file'}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-4 leading-relaxed">
                {googleAppInfo
                  ? `No in-app preview is available for this format, but ${googleAppInfo.name} can open it — Drive converts the file on the way in. You can also download it to open locally.`
                  : 'No native preview available for this file type. You can download the file to open it locally on your computer.'}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
                {googleAppInfo && (
                  <a
                    href={googleAppInfo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`px-5 py-2.5 rounded-xl text-xs font-semibold shadow-lg transition-colors flex items-center gap-2 ${googleAppInfo.color}`}
                  >
                    <span>Open in {googleAppInfo.name}</span>
                    <OpenInNewIcon fontSize="small" />
                  </a>
                )}
                <a
                  href={fileUrl}
                  download={fileName}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg transition-colors flex items-center gap-2"
                >
                  <DownloadIcon fontSize="small" />
                  <span>Download</span>
                </a>
                {webViewLink && (
                  <a
                    href={webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition-colors flex items-center gap-1.5"
                  >
                    <OpenInNewIcon fontSize="small" />
                    <span>Open in Drive</span>
                  </a>
                )}
              </div>
            </div>
          )}
        </main>

        {/* ========================================================================= */}
        {/* RIGHT SIDE DETAILS / INFO DRAWER                                         */}
        {/* ========================================================================= */}
        {showInfo && (
          <aside className="w-80 shrink-0 bg-white/95 dark:bg-slate-900/95 border-l border-slate-200 dark:border-slate-800 p-5 overflow-y-auto z-20 backdrop-blur-xl shadow-2xl flex flex-col justify-between">
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">File Details</h4>
                <IconButton size="small" onClick={() => setShowInfo(false)} sx={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
                <div className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
                  {getTypeIcon(previewKind)}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 dark:text-slate-200 truncate" title={fileName}>
                    {fileName}
                  </p>
                  <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 uppercase font-semibold">
                    {previewKind}
                  </span>
                </div>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-slate-500 dark:text-slate-400 font-medium block mb-0.5">Type</span>
                  <span className="text-slate-700 dark:text-slate-300 font-mono text-[11px] break-all">{mimeType || 'Unknown'}</span>
                </div>

                <div>
                  <span className="text-slate-500 dark:text-slate-400 font-medium block mb-0.5">Size</span>
                  <span className="text-slate-900 dark:text-slate-300 font-semibold">{formatBytes(fileSize)}</span>
                  {fileSize && (
                    <span className="text-slate-500 dark:text-slate-400 text-[10px] ml-1">({fileSize.toLocaleString()} bytes)</span>
                  )}
                </div>

                {modifiedTime && (
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 font-medium block mb-0.5">Modified</span>
                    <span className="text-slate-700 dark:text-slate-300">{new Date(modifiedTime).toLocaleString()}</span>
                  </div>
                )}

                {createdTime && (
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 font-medium block mb-0.5">Created</span>
                    <span className="text-slate-700 dark:text-slate-300">{new Date(createdTime).toLocaleString()}</span>
                  </div>
                )}

                {owners && owners.length > 0 && (
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 font-medium block mb-1">Owner</span>
                    <div className="flex items-center gap-2">
                      {owners[0].picture ? (
                        <img src={owners[0].picture} alt="" className="w-5 h-5 rounded-full" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-indigo-600 text-[10px] text-white flex items-center justify-center font-bold">
                          {owners[0].displayName?.charAt(0) || 'U'}
                        </div>
                      )}
                      <span className="text-slate-800 dark:text-slate-200 truncate">{owners[0].displayName || owners[0].emailAddress}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-6 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2">
              <button
                onClick={handleCopyLink}
                className="w-full py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
              >
                {copiedLink ? <CheckIcon fontSize="small" sx={{ color: '#10b981' }} /> : <ContentCopyIcon fontSize="small" />}
                <span>{copiedLink ? 'Link Copied!' : 'Copy Link'}</span>
              </button>

              {webViewLink && (
                <a
                  href={webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  <OpenInNewIcon fontSize="small" />
                  <span>Open in Google Drive</span>
                </a>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
