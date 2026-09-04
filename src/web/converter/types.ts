import { DriveItemView } from '../../shared/contracts';

export type MediaType = 'video' | 'audio' | 'document';

export interface PresetItem {
  id: string;
  name: string;
  name2: string; // e.g. "1920x1080", "128 kbps"
  width?: number;
  height?: number;
  vb?: number; // video bitrate kbps
  ab?: number; // audio bitrate kbps
  ac?: number; // audio channels
  ar?: number; // audio sample rate Hz
  sampleSize?: number; // sample bit depth
}

export interface FormatConfig {
  id: string;
  label: string;
  extension: string;
  ffmpegFormat?: string;
  defaultPreset: string;
  presets?: Record<string, PresetItem>;
  vcodecs?: string[];
  acodecs?: string[];
  defaults: {
    vcodec?: string;
    acodec?: string;
    ab?: number;
    ac?: number;
    ar?: number;
  };
}

export const VIDEO_RESOLUTIONS: PresetItem[] = [
  { id: 'same', name: 'Same as source', name2: '' },
  { id: 'hd1080p', name: 'HD 1080p', name2: '1920x1080', width: 1920, height: 1080, vb: 9000 },
  { id: 'hd720p', name: 'HD 720p', name2: '1280x720', width: 1280, height: 720, vb: 4500 },
  { id: '480p', name: '480p', name2: '854x480', width: 854, height: 480, vb: 1500 },
  { id: '360p', name: '360p', name2: '640x360', width: 640, height: 360, vb: 900 },
  { id: '240p', name: '240p', name2: '426x240', width: 426, height: 240, vb: 450 },
  { id: 'dvd', name: 'DVD', name2: '720x576', width: 720, height: 576, vb: 2000 },
  { id: 'tv', name: 'TV', name2: '640x480', width: 640, height: 480, vb: 1500 },
  { id: 'mobile', name: 'Mobile', name2: '320x240', width: 320, height: 240, vb: 350, ac: 1, ab: 64 },
];

export const THREEGP_RESOLUTIONS: PresetItem[] = [
  { id: 'hd720p', name: 'HD 720p', name2: '1280x720', width: 1280, height: 720, vb: 4500 },
  { id: '480p', name: '480p', name2: '854x480', width: 854, height: 480 },
  { id: '360p', name: '360p', name2: '640x360', width: 640, height: 360 },
  { id: '240p', name: '240p', name2: '426x240', width: 426, height: 240 },
  { id: 'tv', name: 'TV', name2: '640x480', width: 640, height: 480 },
  { id: '320x240', name: '320x240', name2: '320x240', width: 320, height: 240, ab: 64, ac: 1 },
  { id: '176x144', name: '176x144', name2: '176x144', width: 176, height: 144, ac: 1, ab: 12 },
  { id: '128x96', name: '128x96', name2: '128x96', width: 128, height: 96, ac: 1, ab: 12 },
];

export const VIDEO_FORMATS: Record<string, FormatConfig> = {
  mp4: {
    id: 'mp4',
    label: 'mp4',
    extension: 'mp4',
    ffmpegFormat: 'mp4',
    defaultPreset: 'same',
    presets: Object.fromEntries(VIDEO_RESOLUTIONS.map((r) => [r.id, r])),
    vcodecs: ['h264', 'mpeg4', 'h265'],
    acodecs: ['aac', 'mp3'],
    defaults: { vcodec: 'h264', acodec: 'aac', ab: 128, ac: 2 },
  },
  avi: {
    id: 'avi',
    label: 'avi',
    extension: 'avi',
    ffmpegFormat: 'avi',
    defaultPreset: 'same',
    presets: Object.fromEntries(VIDEO_RESOLUTIONS.map((r) => [r.id, r])),
    vcodecs: ['h264', 'mpeg1', 'mpeg2', 'mpeg4', 'mjpeg'],
    acodecs: ['mp3', 'mp2', 'pcm'],
    defaults: { vcodec: 'h264', acodec: 'mp3', ab: 128, ac: 2 },
  },
  mpeg: {
    id: 'mpeg',
    label: 'mpeg',
    extension: 'mpg',
    ffmpegFormat: 'mpeg',
    defaultPreset: 'same',
    presets: Object.fromEntries(VIDEO_RESOLUTIONS.map((r) => [r.id, r])),
    vcodecs: ['mpeg2', 'mpeg1'],
    acodecs: ['mp2'],
    defaults: { vcodec: 'mpeg2', acodec: 'mp2', ab: 128, ac: 2 },
  },
  mov: {
    id: 'mov',
    label: 'mov',
    extension: 'mov',
    ffmpegFormat: 'mov',
    defaultPreset: 'same',
    presets: Object.fromEntries(VIDEO_RESOLUTIONS.map((r) => [r.id, r])),
    vcodecs: ['h264', 'mpeg4', 'mjpeg', 'h265'],
    acodecs: ['aac', 'alac', 'mp3'],
    defaults: { vcodec: 'h264', acodec: 'aac', ab: 192, ac: 2 },
  },
  flv: {
    id: 'flv',
    label: 'flv',
    extension: 'flv',
    ffmpegFormat: 'flv',
    defaultPreset: 'same',
    presets: Object.fromEntries(VIDEO_RESOLUTIONS.map((r) => [r.id, r])),
    vcodecs: ['h264', 'flv', 'flashsv', 'flashsv2'],
    acodecs: ['aac', 'mp3'],
    defaults: { vcodec: 'h264', acodec: 'aac', ab: 128, ac: 2 },
  },
  '3gp': {
    id: '3gp',
    label: '3gp',
    extension: '3gp',
    ffmpegFormat: '3gp',
    defaultPreset: '176x144',
    presets: Object.fromEntries(THREEGP_RESOLUTIONS.map((r) => [r.id, r])),
    vcodecs: ['mpeg4', 'h264'],
    acodecs: ['aac'],
    defaults: { vcodec: 'mpeg4', acodec: 'aac', ab: 128, ac: 2 },
  },
  webm: {
    id: 'webm',
    label: 'webm',
    extension: 'webm',
    ffmpegFormat: 'webm',
    defaultPreset: 'same',
    presets: Object.fromEntries(VIDEO_RESOLUTIONS.map((r) => [r.id, r])),
    vcodecs: ['vp8', 'vp9'],
    acodecs: ['vorbis'],
    defaults: { vcodec: 'vp8', acodec: 'vorbis', ab: 128, ac: 2 },
  },
  mkv: {
    id: 'mkv',
    label: 'mkv',
    extension: 'mkv',
    ffmpegFormat: 'matroska',
    defaultPreset: 'same',
    presets: Object.fromEntries(VIDEO_RESOLUTIONS.map((r) => [r.id, r])),
    vcodecs: ['h264', 'mpeg2', 'mpeg4', 'mjpeg', 'vp9', 'h265'],
    acodecs: ['aac', 'mp3', 'alac', 'vorbis'],
    defaults: { vcodec: 'h264', acodec: 'aac', ab: 192, ac: 2 },
  },
  wmv: {
    id: 'wmv',
    label: 'wmv',
    extension: 'wmv',
    ffmpegFormat: 'asf',
    defaultPreset: 'same',
    presets: Object.fromEntries(VIDEO_RESOLUTIONS.map((r) => [r.id, r])),
    vcodecs: ['wmv2', 'wmv1'],
    acodecs: ['wma2', 'wma1'],
    defaults: { vcodec: 'wmv2', acodec: 'wma2', ab: 192, ac: 2 },
  },
};

export interface AudioPresetStop {
  id: 'first' | 'second' | 'third' | 'fourth';
  name: string;
  name2: string;
  ab?: number;
  ac?: number;
  ar?: number;
  sampleSize?: number;
}

export const AUDIO_PRESETS: PresetItem[] = [
  { id: 'first', name: 'Economy', name2: '64 kbps', ab: 64, ac: 1 },
  { id: 'second', name: 'Standard', name2: '128 kbps', ab: 128, ac: 2 },
  { id: 'third', name: 'Good', name2: '192 kbps', ab: 192, ac: 2 },
  { id: 'fourth', name: 'Best', name2: '320 kbps', ab: 320, ac: 2 },
];

export interface AudioFormatDetails {
  id: string;
  label: string;
  longName?: string;
  extension: string;
  ffmpegFormat?: string;
  defaultPreset?: 'first' | 'second' | 'third' | 'fourth';
  defaultVariableBitrate?: number;
  presets?: Record<'first' | 'second' | 'third' | 'fourth', AudioPresetStop>;
  bitrates?: number[];
  bitratesVariable?: number[];
  sampleRates?: number[];
  channels?: number[];
  defaults: {
    ac?: number;
    ar?: number;
    ab?: number;
    acodec?: string;
  };
}

export const AUDIO_PRESET_MAP = {
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
  0: 'first',
  1: 'second',
  2: 'third',
  3: 'fourth',
} as const;

export const AUDIO_FORMATS: Record<string, AudioFormatDetails & FormatConfig> = {
  mp3: {
    id: 'mp3',
    label: 'mp3',
    longName: 'MP3',
    extension: 'mp3',
    ffmpegFormat: 'mp3',
    defaultPreset: 'second',
    defaultVariableBitrate: 5,
    presets: {
      first: { id: 'first', name: 'Economy', name2: '64 kbps', ab: 64, ac: 1 },
      second: { id: 'second', name: 'Standard', name2: '128 kbps', ab: 128, ac: 2 },
      third: { id: 'third', name: 'Good', name2: '192 kbps', ab: 192, ac: 2 },
      fourth: { id: 'fourth', name: 'Best', name2: '320 kbps', ab: 320, ac: 2 },
    },
    bitrates: [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    bitratesVariable: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    channels: [1, 2],
    sampleRates: [32000, 44100, 48000],
    defaults: { ac: 2, ar: 44100, ab: 128, acodec: 'mp3' },
  },
  wav: {
    id: 'wav',
    label: 'wav',
    longName: 'WAV',
    extension: 'wav',
    ffmpegFormat: 'wav',
    defaultPreset: 'second',
    presets: {
      first: { id: 'first', name: 'Tape quality', name2: '20 Khz', ac: 2, sampleSize: 16, ar: 22050 },
      second: { id: 'second', name: 'CD quality', name2: '44.1 Khz', ac: 2, sampleSize: 16, ar: 44100 },
      third: { id: 'third', name: 'DVD quality', name2: '48 Khz', ac: 2, sampleSize: 16, ar: 48000 },
      fourth: { id: 'fourth', name: 'Hi-Res quality', name2: '96 Khz', ac: 2, sampleSize: 32, ar: 96000 },
    },
    channels: [1, 2],
    sampleRates: [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000],
    defaults: { ac: 2, ar: 44100, acodec: 'pcm' },
  },
  m4r: {
    id: 'm4r',
    label: 'iPhone',
    longName: 'iPhone',
    extension: 'm4r',
    ffmpegFormat: 'mp4',
    defaultPreset: 'third',
    presets: {
      first: { id: 'first', name: 'Economy', name2: '64 kbps', ab: 64, ac: 1 },
      second: { id: 'second', name: 'Standard', name2: '128 kbps', ab: 128, ac: 2 },
      third: { id: 'third', name: 'Good', name2: '160 kbps', ab: 160, ac: 2 },
      fourth: { id: 'fourth', name: 'Best', name2: '256 kbps', ab: 256, ac: 2 },
    },
    bitrates: [16, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512],
    channels: [1, 2],
    sampleRates: [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000],
    defaults: { ac: 2, ar: 44100, ab: 160, acodec: 'aac' },
  },
  m4a: {
    id: 'm4a',
    label: 'm4a',
    longName: 'M4A',
    extension: 'm4a',
    ffmpegFormat: 'mp4',
    defaultPreset: 'third',
    presets: {
      first: { id: 'first', name: 'Economy', name2: '64 kbps', ab: 64, ac: 1 },
      second: { id: 'second', name: 'Standard', name2: '128 kbps', ab: 128, ac: 2 },
      third: { id: 'third', name: 'Good', name2: '160 kbps', ab: 160, ac: 2 },
      fourth: { id: 'fourth', name: 'Best', name2: '256 kbps', ab: 256, ac: 2 },
    },
    bitrates: [16, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512],
    channels: [1, 2],
    sampleRates: [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000],
    defaults: { ac: 2, ar: 44100, ab: 256, acodec: 'aac' },
  },
  flac: {
    id: 'flac',
    label: 'flac',
    longName: 'FLAC',
    extension: 'flac',
    ffmpegFormat: 'flac',
    defaultPreset: 'second',
    channels: [1, 2],
    sampleRates: [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000],
    defaults: { ac: 2, ar: 48000, acodec: 'flac' },
  },
  ogg: {
    id: 'ogg',
    label: 'ogg',
    longName: 'OGG',
    extension: 'ogg',
    ffmpegFormat: 'ogg',
    defaultPreset: 'third',
    presets: {
      first: { id: 'first', name: 'Economy', name2: '64 kbps', ab: 64, ac: 1 },
      second: { id: 'second', name: 'Standard', name2: '128 kbps', ab: 128, ac: 2 },
      third: { id: 'third', name: 'Good', name2: '160 kbps', ab: 160, ac: 2 },
      fourth: { id: 'fourth', name: 'Best', name2: '256 kbps', ab: 256, ac: 2 },
    },
    bitrates: [96, 112, 128, 160, 192, 224, 256],
    channels: [1, 2],
    sampleRates: [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000],
    defaults: { ac: 2, ar: 44100, ab: 160, acodec: 'vorbis' },
  },
  mp2: {
    id: 'mp2',
    label: 'mp2',
    longName: 'MP2',
    extension: 'mp2',
    ffmpegFormat: 'mp2',
    defaultPreset: 'third',
    presets: {
      first: { id: 'first', name: 'Economy', name2: '64 kbps', ab: 64, ac: 1 },
      second: { id: 'second', name: 'Standard', name2: '128 kbps', ab: 128, ac: 2 },
      third: { id: 'third', name: 'Good', name2: '160 kbps', ab: 160, ac: 2 },
      fourth: { id: 'fourth', name: 'Best', name2: '256 kbps', ab: 256, ac: 2 },
    },
    bitrates: [64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    channels: [1, 2],
    sampleRates: [22050, 24000, 32000, 44100, 48000],
    defaults: { ac: 2, ar: 44100, ab: 192, acodec: 'mp2' },
  },
  amr: {
    id: 'amr',
    label: 'amr',
    longName: 'AMR',
    extension: 'amr',
    ffmpegFormat: 'amr',
    defaultPreset: 'second',
    bitrates: [4.75, 5.15, 5.9, 6.7, 7.4, 7.95, 10.2, 12.2],
    channels: [1],
    sampleRates: [8000],
    defaults: { ac: 1, ar: 8000, ab: 12.2, acodec: 'amr_nb' },
  },
};

export const CODEC_DISPLAY_NAMES: Record<string, string> = {
  h264: 'H.264 / AVC',
  h265: 'H.265 / HEVC',
  mpeg4: 'MPEG-4',
  mpeg1: 'MPEG-1',
  mpeg2: 'MPEG-2',
  mjpeg: 'Motion JPEG',
  vp8: 'VP8',
  vp9: 'VP9',
  flv: 'Flash Video (Sorenson H.263)',
  flashsv: 'Flash Screen Video',
  flashsv2: 'Flash Screen Video 2',
  theora: 'Theora',
  wmv1: 'Windows Media Video 7 (WMV1)',
  wmv2: 'Windows Media Video 8 (WMV2)',
  aac: 'AAC',
  mp3: 'MP3',
  mp2: 'MP2',
  vorbis: 'Ogg Vorbis',
  wma1: 'Windows Media Audio 1',
  wma2: 'Windows Media Audio 2',
  alac: 'Apple Lossless (ALAC)',
  flac: 'FLAC',
  pcm: 'WAV PCM',
  amr_nb: 'AMR-NB',
};

export interface DocumentFormatItem {
  id: string;
  label: string;
  extension: string;
  name: string;
  category: 'document' | 'spreadsheet' | 'presentation' | 'ebook';
  description?: string;
}

export const DOCUMENT_FORMATS: Record<string, DocumentFormatItem> = {
  pdf: { id: 'pdf', label: 'pdf', extension: 'pdf', name: 'PDF Document', category: 'document', description: 'Portable Document Format' },
  docx: { id: 'docx', label: 'docx', extension: 'docx', name: 'Word Document', category: 'document', description: 'Microsoft Word Document (XML)' },
  doc: { id: 'doc', label: 'doc', extension: 'doc', name: 'Word 97-2004', category: 'document', description: 'Microsoft Word 97-2004' },
  txt: { id: 'txt', label: 'txt', extension: 'txt', name: 'Plain Text', category: 'document', description: 'Unformatted Plain Text' },
  rtf: { id: 'rtf', label: 'rtf', extension: 'rtf', name: 'Rich Text', category: 'document', description: 'Rich Text Format' },
  odt: { id: 'odt', label: 'odt', extension: 'odt', name: 'OpenDocument Text', category: 'document', description: 'OpenDocument Text Document' },
  html: { id: 'html', label: 'html', extension: 'html', name: 'HTML Document', category: 'document', description: 'HyperText Markup Language' },
  epub: { id: 'epub', label: 'epub', extension: 'epub', name: 'EPUB E-Book', category: 'ebook', description: 'Electronic Publication' },
  mobi: { id: 'mobi', label: 'mobi', extension: 'mobi', name: 'MOBI E-Book', category: 'ebook', description: 'Mobipocket E-Book' },
  xlsx: { id: 'xlsx', label: 'xlsx', extension: 'xlsx', name: 'Excel Spreadsheet', category: 'spreadsheet', description: 'Microsoft Excel Spreadsheet (XML)' },
  xls: { id: 'xls', label: 'xls', extension: 'xls', name: 'Excel 97-2004', category: 'spreadsheet', description: 'Microsoft Excel 97-2004' },
  pptx: { id: 'pptx', label: 'pptx', extension: 'pptx', name: 'PowerPoint', category: 'presentation', description: 'Microsoft PowerPoint Presentation (XML)' },
  ppt: { id: 'ppt', label: 'ppt', extension: 'ppt', name: 'PowerPoint 97-2004', category: 'presentation', description: 'Microsoft PowerPoint 97-2004' },
  csv: { id: 'csv', label: 'csv', extension: 'csv', name: 'CSV Document', category: 'spreadsheet', description: 'Comma Separated Values' },
};

export const PRIMARY_DOCUMENT_FORMAT_KEYS = ['pdf', 'docx', 'txt', 'rtf', 'odt'];

export interface TrackInfo {
  setTag: boolean;
  title: string;
  artist: string;
  album: string;
  year: string;
  genre: string;
  comment: string;
}

export interface AudioAdvancedOptions {
  bitrateType: 'constant' | 'variable';
  constantBitrate: number;
  variableBitrate: number; // 0..9
  sampleRate: number;
  channels: number;
  fadeIn: boolean;
  fadeOut: boolean;
  reverse: boolean;
  fastMode?: boolean;
}

export interface ConversionOptions {
  mediaType: MediaType;
  format: string;
  preset: string;
  vcodec: string;
  acodec: string;
  noAudio: boolean;
  convertFrom?: string;
  originalFilename?: string;
  audioAdvanced?: AudioAdvancedOptions;
  trackInfo?: TrackInfo;
  targetFilesizeMb?: number; // Target output size in MB
  vb?: number; // Explicit video bitrate kbps
  ab?: number; // Explicit audio bitrate kbps
}

export type ConversionPhase = 'idle' | 'uploading' | 'encoding' | 'completed' | 'error';

export interface ConversionResult {
  downloadUrl: string;
  browserFilename: string;
  publicFilename?: string;
  filesize?: number;
  uid?: string;
}

export interface ConversionState {
  phase: ConversionPhase;
  uploadProgress: number; // 0 - 100
  uploadSpeedMb: number; // MB/s
  uploadEtaSec: number;
  encodeProgress: number; // 0 - 100
  statusText: string;
  result: ConversionResult | null;
  error: string | null;
}

export interface SelectedDriveFile {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  parentFolderId?: string;
  videoMetadata?: {
    width?: number;
    height?: number;
    durationMillis?: number;
  };
}
