import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '@mui/material/styles';
import {
  Dialog,
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
  | 'office'
  | 'unsupported';

function getFileExtension(filename?: string): string {
  if (!filename) return '';
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

function detectPreviewKind(filename?: string, mimeType?: string): PreviewKind {
  const ext = getFileExtension(filename);
  const mime = (mimeType || '').toLowerCase();

  // Google Workspace apps
  if (mime.includes('vnd.google-apps.document')) return 'gdoc';
  if (mime.includes('vnd.google-apps.spreadsheet')) return 'gsheet';
  if (mime.includes('vnd.google-apps.presentation')) return 'gslide';

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

  // Office docs
  const officeExts = ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods', 'odp'];
  if (officeExts.includes(ext) || mime.includes('word') || mime.includes('sheet') || mime.includes('presentation')) {
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

function getGoogleAppOptions(fileId: string, mimeType?: string, filename?: string) {
  const ext = getFileExtension(filename);
  const apps: Array<{ name: string; url: string; icon: string }> = [];

  if (
    mimeType?.includes('document') ||
    mimeType?.includes('text') ||
    mimeType?.includes('word') ||
    ['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)
  ) {
    apps.push({
      name: 'Google Docs',
      url: `https://docs.google.com/document/d/${fileId}/edit`,
      icon: 'doc',
    });
  }

  if (
    mimeType?.includes('spreadsheet') ||
    mimeType?.includes('excel') ||
    mimeType?.includes('csv') ||
    ['xls', 'xlsx', 'csv', 'tsv', 'ods'].includes(ext)
  ) {
    apps.push({
      name: 'Google Sheets',
      url: `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
      icon: 'sheet',
    });
  }

  if (
    mimeType?.includes('presentation') ||
    mimeType?.includes('powerpoint') ||
    ['ppt', 'pptx', 'odp'].includes(ext)
  ) {
    apps.push({
      name: 'Google Slides',
      url: `https://docs.google.com/presentation/d/${fileId}/edit`,
      icon: 'slides',
    });
  }

  apps.push({
    name: 'Google Drive Viewer',
    url: `https://drive.google.com/file/d/${fileId}/view`,
    icon: 'drive',
  });

  return apps;
}

function getTypeIcon(kind: PreviewKind) {
  switch (kind) {
    case 'image':
      return <ImageIcon sx={{ color: '#f43f5e' }} />;
    case 'video':
      return <VideocamIcon sx={{ color: '#a855f7' }} />;
    case 'audio':
      return <AudioFileIcon sx={{ color: '#f59e0b' }} />;
    case 'pdf':
      return <DescriptionIcon sx={{ color: '#ef4444' }} />;
    case 'csv':
    case 'gsheet':
      return <TableChartIcon sx={{ color: '#10b981' }} />;
    case 'gdoc':
      return <DescriptionIcon sx={{ color: '#3b82f6' }} />;
    case 'gslide':
      return <DescriptionIcon sx={{ color: '#f97316' }} />;
    case 'code':
    case 'markdown':
      return <CodeIcon sx={{ color: '#6366f1' }} />;
    default:
      return <InsertDriveFileIcon sx={{ color: '#94a3b8' }} />;
  }
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
  // Navigation active index state
  const [activeIndex, setActiveIndex] = useState<number>(propCurrentIndex ?? 0);

  useEffect(() => {
    if (propCurrentIndex !== undefined) {
      setActiveIndex(propCurrentIndex);
    }
  }, [propCurrentIndex]);

  // Theme state: reactive to MUI ThemeProvider and document dark class
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

  // Derived current file item
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

  // Image viewer state
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

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

  // Reset transforms and state when switching files
  useEffect(() => {
    setLoading(true);
    setZoom(1);
    setRotation(0);
    setPanOffset({ x: 0, y: 0 });
    setTextContent(null);
    setTextError(null);
    setIsPlaying(false);
    setIsAudioPlaying(false);
    setActiveTab('preview');
  }, [fileId]);

  // Fetch text content for code/markdown/csv
  useEffect(() => {
    if (!open || !fileId) return;

    if (previewKind === 'code' || previewKind === 'markdown' || previewKind === 'csv') {
      let isSubscribed = true;
      setLoading(true);
      setTextError(null);

      fetch(fileUrl)
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`Failed to load file content (${res.status})`);
          }
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
    } else if (previewKind === 'image') {
      // Preload image
      const img = new Image();
      img.src = fileUrl;
      img.onload = () => setLoading(false);
      img.onerror = () => {
        // Fallback to high-res thumbnail if available
        if (thumbnailLink) {
          const highRes = thumbnailLink.replace(/=s\d+/, '=s1600');
          img.src = highRes;
          img.onload = () => setLoading(false);
          img.onerror = () => setLoading(false);
        } else {
          setLoading(false);
        }
      };
    } else {
      // For video/audio/pdf/iframe, let elements handle loading
      const timer = setTimeout(() => setLoading(false), 800);
      return () => clearTimeout(timer);
    }
  }, [open, fileId, previewKind, fileUrl, thumbnailLink]);

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

  // Keyboard navigation & shortcuts
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

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
        setZoom((prev) => Math.min(5, prev + 0.25));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoom((prev) => Math.max(0.25, prev - 0.25));
      } else if (e.key === '0') {
        e.preventDefault();
        setZoom(1);
        setRotation(0);
        setPanOffset({ x: 0, y: 0 });
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        setShowInfo((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose, handlePrev, handleNext]);

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

  // Print helper
  const handlePrint = () => {
    if (previewKind === 'pdf' || previewKind === 'image' || previewKind === 'code') {
      const printWindow = window.open(fileUrl, '_blank');
      if (printWindow) {
        printWindow.focus();
        printWindow.print();
      }
    } else {
      window.print();
    }
  };

  // Copy link helper
  const handleCopyLink = () => {
    const link = webViewLink || fileUrl;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  // Copy code helper
  const handleCopyCode = () => {
    if (!textContent) return;
    navigator.clipboard.writeText(textContent).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  };

  const googleApps = getGoogleAppOptions(fileId, mimeType, fileName);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // CSV table parsing
  const parsedCsvRows = React.useMemo(() => {
    if (previewKind !== 'csv' || !textContent) return { headers: [], rows: [] };
    const lines = textContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { headers: [], rows: [] };

    const parseLine = (line: string) => {
      const isTsv = fileName.endsWith('.tsv');
      if (isTsv) return line.split('\t');
      // Simple CSV split matching quoted strings
      const result: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(cur.trim());
          cur = '';
        } else {
          cur += char;
        }
      }
      result.push(cur.trim());
      return result;
    };

    const headers = parseLine(lines[0]);
    const rawRows = lines.slice(1).map(parseLine);
    const rows = csvSearch
      ? rawRows.filter((r) => r.some((cell) => cell.toLowerCase().includes(csvSearch.toLowerCase())))
      : rawRows;

    return { headers, rows };
  }, [previewKind, textContent, fileName, csvSearch]);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      PaperProps={{
        sx: {
          bgcolor: isDarkMode ? '#0f172a' : '#f8fafc',
          color: isDarkMode ? '#f8fafc' : '#0f172a',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          userSelect: 'none',
        },
      }}
    >
      {/* ========================================================================= */}
      {/* GOOGLE DRIVE NATIVE PREVIEW TOPBAR                                       */}
      {/* ========================================================================= */}
      <header className="h-14 shrink-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-3 sm:px-4 flex items-center justify-between gap-3 z-30">
        {/* Left: Back / Close, File Icon, Name & Index */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <IconButton
            size="small"
            onClick={onClose}
            title="Close (Esc)"
            sx={{
              color: isDarkMode ? '#94a3b8' : '#64748b',
              '&:hover': {
                color: isDarkMode ? '#ffffff' : '#0f172a',
                bgcolor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
              },
            }}
          >
            <ArrowBackIcon fontSize="small" />
          </IconButton>

          <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
            {getTypeIcon(previewKind)}
          </div>

          <div className="min-w-0 flex flex-col">
            <div className="flex items-center gap-2">
              <span
                className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[200px] sm:max-w-[400px] md:max-w-[550px]"
                title={fileName}
              >
                {fileName}
              </span>
              {hasMultipleFiles && (
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700/60 shrink-0">
                  {activeIndex + 1} of {totalFiles}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Center: Image & Doc Toolbar (Zoom, Rotate, Print) */}
        <div className="hidden md:flex items-center gap-1 bg-slate-100 dark:bg-slate-800/60 rounded-xl p-1 border border-slate-200 dark:border-slate-700/50">
          {previewKind === 'image' && (
            <>
              <Tooltip title="Zoom Out (-)">
                <IconButton
                  size="small"
                  onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                  disabled={zoom <= 0.25}
                  sx={{ color: isDarkMode ? '#cbd5e1' : '#475569' }}
                >
                  <ZoomOutIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              <span className="text-xs font-mono px-1.5 text-slate-700 dark:text-slate-300 min-w-[48px] text-center">
                {Math.round(zoom * 100)}%
              </span>

              <Tooltip title="Zoom In (+)">
                <IconButton
                  size="small"
                  onClick={() => setZoom((z) => Math.min(5, z + 0.25))}
                  disabled={zoom >= 5}
                  sx={{ color: isDarkMode ? '#cbd5e1' : '#475569' }}
                >
                  <ZoomInIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              <Tooltip title="Reset Zoom (0)">
                <IconButton
                  size="small"
                  onClick={() => {
                    setZoom(1);
                    setRotation(0);
                    setPanOffset({ x: 0, y: 0 });
                  }}
                  sx={{ color: isDarkMode ? '#cbd5e1' : '#475569' }}
                >
                  <RestartAltIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              <Tooltip title="Rotate 90°">
                <IconButton
                  size="small"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  sx={{ color: isDarkMode ? '#cbd5e1' : '#475569' }}
                >
                  <RotateRightIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}

          {(previewKind === 'code' || previewKind === 'markdown') && (
            <>
              <Tooltip title={wrapText ? 'Disable Word Wrap' : 'Enable Word Wrap'}>
                <IconButton
                  size="small"
                  onClick={() => setWrapText((w) => !w)}
                  sx={{ color: wrapText ? '#38bdf8' : (isDarkMode ? '#94a3b8' : '#64748b') }}
                >
                  <WrapTextIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={copiedCode ? 'Copied!' : 'Copy Code'}>
                <IconButton size="small" onClick={handleCopyCode} sx={{ color: isDarkMode ? '#cbd5e1' : '#475569' }}>
                  {copiedCode ? <CheckIcon fontSize="small" sx={{ color: '#4ade80' }} /> : <ContentCopyIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
              {previewKind === 'markdown' && (
                <div className="flex rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs ml-1">
                  <button
                    onClick={() => setActiveTab('preview')}
                    className={`px-2 py-0.5 transition-colors ${activeTab === 'preview' ? 'bg-indigo-600 text-white font-medium' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => setActiveTab('raw')}
                    className={`px-2 py-0.5 transition-colors ${activeTab === 'raw' ? 'bg-indigo-600 text-white font-medium' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                  >
                    Raw
                  </button>
                </div>
              )}
            </>
          )}

          {previewKind === 'csv' && (
            <div className="flex items-center gap-1.5 px-2">
              <SearchIcon fontSize="small" sx={{ color: isDarkMode ? '#94a3b8' : '#64748b' }} />
              <input
                type="text"
                placeholder="Filter table..."
                value={csvSearch}
                onChange={(e) => setCsvSearch(e.target.value)}
                className="bg-white dark:bg-slate-900/80 text-xs text-slate-800 dark:text-slate-200 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 focus:outline-none focus:border-indigo-500 w-28 lg:w-44"
              />
            </div>
          )}

          {(previewKind === 'pdf' || previewKind === 'image' || previewKind === 'code') && (
            <Tooltip title="Print">
              <IconButton size="small" onClick={handlePrint} sx={{ color: isDarkMode ? '#cbd5e1' : '#475569' }}>
                <PrintIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </div>

        {/* Right: Open With Menu, Download, Info Drawer, More & Close */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Open with Dropdown */}
          <button
            onClick={(e) => setMenuAnchorEl(e.currentTarget)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition-colors"
          >
            <span>Open with</span>
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Download Action */}
          <a
            href={fileUrl}
            download={fileName}
            title="Download file"
            className="p-1.5 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800 transition-colors flex items-center justify-center"
          >
            <DownloadIcon fontSize="small" />
          </a>

          {/* File Info Details Panel Toggle */}
          <Tooltip title="File details (i)">
            <IconButton
              size="small"
              onClick={() => setShowInfo((s) => !s)}
              sx={{
                color: showInfo ? '#38bdf8' : (isDarkMode ? '#94a3b8' : '#64748b'),
                bgcolor: showInfo ? (isDarkMode ? 'rgba(56, 189, 248, 0.1)' : 'rgba(56, 189, 248, 0.12)') : 'transparent',
                '&:hover': {
                  color: isDarkMode ? '#ffffff' : '#0f172a',
                  bgcolor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                },
              }}
            >
              <InfoOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {/* Close Window */}
          <IconButton
            size="small"
            onClick={onClose}
            title="Close"
            sx={{
              color: isDarkMode ? '#94a3b8' : '#64748b',
              '&:hover': {
                color: isDarkMode ? '#ffffff' : '#0f172a',
                bgcolor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
              },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* MAIN PREVIEW STAGE + SLIDING DETAILS DRAWER                              */}
      {/* ========================================================================= */}
      <div className="relative flex-1 flex overflow-hidden bg-slate-100 dark:bg-slate-950">
        {/* Navigation Chevrons (Floating left & right) */}
        {hasMultipleFiles && (
          <>
            <button
              onClick={handlePrev}
              title="Previous file (←)"
              aria-label="Previous file"
              className="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-white/90 hover:bg-white text-slate-700 hover:text-slate-900 border border-slate-200 shadow-xl dark:bg-slate-900/80 dark:hover:bg-slate-800 dark:text-slate-300 dark:hover:text-white dark:border-slate-700/80 dark:shadow-2xl flex items-center justify-center backdrop-blur-md transition-all hover:scale-110 active:scale-95"
            >
              <NavigateBeforeIcon fontSize="medium" />
            </button>

            <button
              onClick={handleNext}
              title="Next file (→)"
              aria-label="Next file"
              className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-white/90 hover:bg-white text-slate-700 hover:text-slate-900 border border-slate-200 shadow-xl dark:bg-slate-900/80 dark:hover:bg-slate-800 dark:text-slate-300 dark:hover:text-white dark:border-slate-700/80 dark:shadow-2xl flex items-center justify-center backdrop-blur-md transition-all hover:scale-110 active:scale-95"
              style={{ right: showInfo ? '340px' : '16px' }}
            >
              <NavigateNextIcon fontSize="medium" />
            </button>
          </>
        )}

        {/* Central Viewport Content Area */}
        <main
          className="flex-1 relative flex items-center justify-center overflow-hidden p-2 sm:p-6"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
        >
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100/70 dark:bg-slate-950/60 backdrop-blur-xs z-10">
              <CircularProgress size={44} sx={{ color: '#6366f1' }} />
              <p className="mt-3 text-xs text-slate-600 dark:text-slate-400 font-medium">Loading preview...</p>
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
                  if (thumbnailLink && (e.currentTarget.src !== thumbnailLink.replace(/=s\d+/, '=s1600'))) {
                    e.currentTarget.src = thumbnailLink.replace(/=s\d+/, '=s1600');
                  }
                }}
                style={{
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                  transition: isPanning ? 'none' : 'transform 0.15s ease-out',
                  maxWidth: '90%',
                  maxHeight: '90%',
                  objectFit: 'contain',
                  boxShadow: isDarkMode ? '0 25px 50px -12px rgba(0, 0, 0, 0.5)' : '0 20px 40px -10px rgba(0, 0, 0, 0.15)',
                }}
                className="rounded-lg select-none"
              />
            </div>
          )}

          {/* ======================= VIDEO PLAYER ======================= */}
          {previewKind === 'video' && (
            <div
              ref={videoContainerRef}
              className="relative w-full max-w-5xl aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl flex flex-col justify-end group border border-slate-200 dark:border-slate-800"
            >
              <video
                ref={videoRef}
                src={fileUrl}
                className="w-full h-full object-contain cursor-pointer"
                onClick={togglePlayVideo}
                onTimeUpdate={() => {
                  if (videoRef.current) {
                    setCurrentTime(videoRef.current.currentTime);
                    setDuration(videoRef.current.duration || 0);
                  }
                }}
                onEnded={() => setIsPlaying(false)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />

              {/* Big Center Play Button Overlay on Pause */}
              {!isPlaying && (
                <button
                  onClick={togglePlayVideo}
                  aria-label="Play video"
                  className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-indigo-600/90 hover:bg-indigo-500 text-white shadow-2xl flex items-center justify-center backdrop-blur-sm transition-transform hover:scale-110"
                >
                  <PlayArrowIcon sx={{ fontSize: 36 }} />
                </button>
              )}

              {/* Video Bottom Custom Controls Bar */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 flex flex-col gap-2 transition-opacity duration-300 opacity-90 group-hover:opacity-100">
                {/* Progress Scrubber Slider */}
                <Slider
                  size="small"
                  value={currentTime}
                  min={0}
                  max={duration || 100}
                  onChange={handleVideoSeek}
                  sx={{
                    color: '#6366f1',
                    height: 4,
                    p: 0,
                    '& .MuiSlider-thumb': {
                      width: 12,
                      height: 12,
                      '&:hover, &.Mui-focusVisible': {
                        boxShadow: '0 0 0 8px rgba(99, 102, 241, 0.16)',
                      },
                    },
                  }}
                />

                <div className="flex items-center justify-between text-xs text-slate-200">
                  <div className="flex items-center gap-3">
                    <IconButton size="small" onClick={togglePlayVideo} sx={{ color: '#ffffff' }}>
                      {isPlaying ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
                    </IconButton>

                    <div className="flex items-center gap-1.5 group/vol">
                      <IconButton size="small" onClick={toggleVideoMute} sx={{ color: '#cbd5e1' }}>
                        {isMuted || volume === 0 ? <VolumeOffIcon fontSize="small" /> : <VolumeUpIcon fontSize="small" />}
                      </IconButton>
                      <Box sx={{ width: 64, display: 'inline-block' }}>
                        <Slider
                          size="small"
                          value={isMuted ? 0 : volume * 100}
                          onChange={handleVideoVolume}
                          sx={{ color: '#94a3b8', height: 3 }}
                        />
                      </Box>
                    </div>

                    <span className="font-mono text-slate-400">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Playback speed selector */}
                    <div className="flex items-center gap-1 bg-slate-800/80 rounded px-1.5 py-0.5 border border-slate-700">
                      {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                        <button
                          key={rate}
                          onClick={() => handleSpeedChange(rate)}
                          className={`text-[10px] px-1 rounded ${playbackRate === rate ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-white'}`}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>

                    {document.pictureInPictureEnabled && (
                      <IconButton
                        size="small"
                        onClick={() => {
                          if (document.pictureInPictureElement) {
                            document.exitPictureInPicture();
                          } else if (videoRef.current) {
                            videoRef.current.requestPictureInPicture();
                          }
                        }}
                        sx={{ color: '#cbd5e1' }}
                      >
                        <PictureInPictureAltIcon fontSize="small" />
                      </IconButton>
                    )}

                    <IconButton size="small" onClick={toggleVideoFullscreen} sx={{ color: '#cbd5e1' }}>
                      {isVideoFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
                    </IconButton>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ======================= AUDIO PLAYER ======================= */}
          {previewKind === 'audio' && (
            <div className="w-full max-w-lg p-6 sm:p-8 rounded-3xl bg-white/95 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 backdrop-blur-2xl shadow-xl dark:shadow-2xl flex flex-col items-center">
              <audio
                ref={audioRef}
                src={fileUrl}
                onTimeUpdate={() => {
                  if (audioRef.current) {
                    setAudioCurrentTime(audioRef.current.currentTime);
                    setAudioDuration(audioRef.current.duration || 0);
                  }
                }}
                onEnded={() => setIsAudioPlaying(false)}
                onPlay={() => setIsAudioPlaying(true)}
                onPause={() => setIsAudioPlaying(false)}
              />

              {/* Animated Wave / Disc Graphic */}
              <div className="relative w-36 h-36 rounded-full bg-gradient-to-tr from-amber-600 to-indigo-600 flex items-center justify-center shadow-xl mb-6">
                <div className={`w-32 h-32 rounded-full bg-slate-50 dark:bg-slate-950 flex items-center justify-center border-4 border-slate-200 dark:border-slate-800 ${isAudioPlaying ? 'animate-spin-slow' : ''}`}>
                  <AudioFileIcon sx={{ fontSize: 48, color: '#f59e0b' }} />
                </div>
              </div>

              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 text-center truncate max-w-full px-2" title={fileName}>
                {fileName}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">{formatBytes(fileSize)}</p>

              {/* Audio Scrubber */}
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

              {/* Audio Controls */}
              <div className="flex items-center justify-between w-full mt-4">
                <div className="flex items-center gap-2">
                  <IconButton size="small" onClick={toggleAudioMute} sx={{ color: isDarkMode ? '#cbd5e1' : '#475569' }}>
                    {isAudioMuted || audioVolume === 0 ? <VolumeOffIcon fontSize="small" /> : <VolumeUpIcon fontSize="small" />}
                  </IconButton>
                  <Box sx={{ width: 60 }}>
                    <Slider
                      size="small"
                      value={isAudioMuted ? 0 : audioVolume * 100}
                      onChange={handleAudioVolume}
                      sx={{ color: '#f59e0b', height: 3 }}
                    />
                  </Box>
                </div>

                <button
                  onClick={togglePlayAudio}
                  aria-label="Play audio"
                  className="w-14 h-14 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95"
                >
                  {isAudioPlaying ? <PauseIcon sx={{ fontSize: 32 }} /> : <PlayArrowIcon sx={{ fontSize: 32 }} />}
                </button>

                <div className="w-20 flex justify-end">
                  <a
                    href={fileUrl}
                    download={fileName}
                    className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800 transition-colors"
                  >
                    <DownloadIcon fontSize="small" />
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* ======================= CODE / TEXT VIEWER ======================= */}
          {(previewKind === 'code' || (previewKind === 'markdown' && activeTab === 'raw')) && (
            <div className="w-full h-full max-w-5xl bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200 dark:border-slate-800 backdrop-blur-xl shadow-xl dark:shadow-2xl flex flex-col overflow-hidden">
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
            <div className="w-full h-full max-w-4xl bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200 dark:border-slate-800 backdrop-blur-xl shadow-xl dark:shadow-2xl p-6 sm:p-10 overflow-auto prose dark:prose-invert max-w-none text-slate-800 dark:text-slate-200 text-sm leading-relaxed">
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
              ) : (
                <p className="text-slate-500 dark:text-slate-400">Loading markdown preview...</p>
              )}
            </div>
          )}

          {/* ======================= CSV / TSV VIEWER ======================= */}
          {previewKind === 'csv' && (
            <div className="w-full h-full max-w-6xl bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200 dark:border-slate-800 backdrop-blur-xl shadow-xl dark:shadow-2xl flex flex-col overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                <span>{parsedCsvRows.rows.length} rows • {parsedCsvRows.headers.length} columns</span>
                {csvSearch && <span>Filtered by "{csvSearch}"</span>}
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead className="bg-slate-100 dark:bg-slate-950/90 sticky top-0 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-300 font-semibold z-10">
                    <tr>
                      <th className="px-3 py-2 border-r border-slate-200 dark:border-slate-800 w-10 text-slate-400 dark:text-slate-500">#</th>
                      {parsedCsvRows.headers.map((h, i) => (
                        <th key={i} className="px-4 py-2 border-r border-slate-200 dark:border-slate-800 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                    {parsedCsvRows.rows.map((row, rowIdx) => (
                      <tr key={rowIdx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-1.5 border-r border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 text-right select-none">
                          {rowIdx + 1}
                        </td>
                        {row.map((cell, colIdx) => (
                          <td key={colIdx} className="px-4 py-1.5 border-r border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ======================= PDF VIEWER ======================= */}
          {previewKind === 'pdf' && (
            <div className="w-full h-full max-w-5xl rounded-2xl overflow-hidden shadow-xl dark:shadow-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <iframe
                src={`https://drive.google.com/file/d/${fileId}/preview?rm=minimal&embedded=true`}
                title={fileName}
                className="w-full h-full border-none"
                allow="autoplay; encrypted-media"
                onLoad={() => setLoading(false)}
              />
            </div>
          )}

          {/* ======================= GOOGLE DOCS / SHEETS / SLIDES / OFFICE ======================= */}
          {(previewKind === 'gdoc' || previewKind === 'gsheet' || previewKind === 'gslide' || previewKind === 'office') && (
            <div className="w-full h-full max-w-5xl rounded-2xl overflow-hidden shadow-xl dark:shadow-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <iframe
                src={`https://drive.google.com/file/d/${fileId}/preview?rm=minimal&embedded=true`}
                title={fileName}
                className="w-full h-full border-none"
                allow="autoplay; encrypted-media"
                onLoad={() => setLoading(false)}
              />
            </div>
          )}

          {/* ======================= UNSUPPORTED / BINARY FALLBACK ======================= */}
          {previewKind === 'unsupported' && (
            <div className="p-8 sm:p-12 rounded-3xl bg-white/95 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 backdrop-blur-2xl shadow-xl dark:shadow-2xl text-center max-w-md flex flex-col items-center">
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
                No native preview available for this file type. You can download the file to open it locally on your computer.
              </p>
              <div className="flex items-center gap-3 mt-6">
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
          <aside className="w-80 shrink-0 bg-white/95 dark:bg-slate-900/95 border-l border-slate-200 dark:border-slate-800 p-5 overflow-y-auto z-20 backdrop-blur-xl shadow-xl dark:shadow-2xl flex flex-col justify-between">
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">File Details</h4>
                <IconButton size="small" onClick={() => setShowInfo(false)} sx={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </div>

              {/* Thumbnail / Icon Badge */}
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

              {/* Properties List */}
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
                      <span className="text-slate-700 dark:text-slate-300 truncate">
                        {owners[0].displayName || owners[0].emailAddress}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Link Copy Action */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={handleCopyLink}
                className="w-full py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center gap-1.5"
              >
                {copiedLink ? <CheckIcon fontSize="small" sx={{ color: '#4ade80' }} /> : <ContentCopyIcon fontSize="small" />}
                <span>{copiedLink ? 'Link Copied!' : 'Copy File Link'}</span>
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* ========================================================================= */}
      {/* OPEN WITH CONTEXT MENU                                                    */}
      {/* ========================================================================= */}
      <Menu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={() => setMenuAnchorEl(null)}
        PaperProps={{
          sx: {
            bgcolor: isDarkMode ? '#1e293b' : '#ffffff',
            color: isDarkMode ? '#f8fafc' : '#0f172a',
            border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
            borderRadius: '12px',
            boxShadow: isDarkMode ? '0 20px 25px -5px rgba(0, 0, 0, 0.5)' : '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
          },
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {googleApps.map((app) => (
          <MenuItem
            key={app.url}
            onClick={() => {
              window.open(app.url, '_blank');
              setMenuAnchorEl(null);
            }}
            sx={{
              fontSize: '13px',
              py: 1,
              px: 2,
              '&:hover': { bgcolor: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' },
            }}
          >
            <OpenInNewIcon fontSize="small" sx={{ mr: 1.5, color: isDarkMode ? '#94a3b8' : '#64748b' }} />
            {app.name}
          </MenuItem>
        ))}
      </Menu>
    </Dialog>
  );
}
