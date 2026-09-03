import { DriveItemView } from '../../shared/contracts';

export type MediaType = 'video' | 'audio';

export interface PresetItem {
  id: string;
  name: string;
  name2: string; // e.g. "1920x1080", "128 kbps"
  width?: number;
  height?: number;
  vb?: number; // video bitrate kbps
  ab?: number; // audio bitrate kbps
  ac?: number; // audio channels
}

export interface FormatConfig {
  id: string;
  label: string;
  extension: string;
  defaultPreset: string;
  presets: Record<string, PresetItem>;
  vcodecs?: string[];
  acodecs?: string[];
  defaults: {
    vcodec?: string;
    acodec?: string;
    ab?: number;
    ac?: number;
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

export const VIDEO_FORMATS: Record<string, FormatConfig> = {
  mp4: {
    id: 'mp4',
    label: 'mp4',
    extension: 'mp4',
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
    defaultPreset: 'same',
    presets: Object.fromEntries(VIDEO_RESOLUTIONS.map((r) => [r.id, r])),
    vcodecs: ['h264', 'mpeg1', 'mpeg2', 'mpeg4', 'mjpeg'],
    acodecs: ['mp3', 'mp2', 'pcm'],
    defaults: { vcodec: 'h264', acodec: 'mp3', ab: 128, ac: 2 },
  },
  mov: {
    id: 'mov',
    label: 'mov',
    extension: 'mov',
    defaultPreset: 'same',
    presets: Object.fromEntries(VIDEO_RESOLUTIONS.map((r) => [r.id, r])),
    vcodecs: ['h264', 'mpeg4', 'mjpeg', 'h265'],
    acodecs: ['aac', 'alac', 'mp3'],
    defaults: { vcodec: 'h264', acodec: 'aac', ab: 192, ac: 2 },
  },
  mkv: {
    id: 'mkv',
    label: 'mkv',
    extension: 'mkv',
    defaultPreset: 'same',
    presets: Object.fromEntries(VIDEO_RESOLUTIONS.map((r) => [r.id, r])),
    vcodecs: ['h264', 'mpeg2', 'mpeg4', 'mjpeg', 'vp9', 'h265'],
    acodecs: ['aac', 'mp3', 'alac', 'vorbis'],
    defaults: { vcodec: 'h264', acodec: 'aac', ab: 192, ac: 2 },
  },
  webm: {
    id: 'webm',
    label: 'webm',
    extension: 'webm',
    defaultPreset: 'same',
    presets: Object.fromEntries(VIDEO_RESOLUTIONS.map((r) => [r.id, r])),
    vcodecs: ['vp8', 'vp9'],
    acodecs: ['vorbis'],
    defaults: { vcodec: 'vp8', acodec: 'vorbis', ab: 128, ac: 2 },
  },
  flv: {
    id: 'flv',
    label: 'flv',
    extension: 'flv',
    defaultPreset: 'same',
    presets: Object.fromEntries(VIDEO_RESOLUTIONS.map((r) => [r.id, r])),
    vcodecs: ['flv', 'h264'],
    acodecs: ['aac', 'mp3'],
    defaults: { vcodec: 'h264', acodec: 'aac', ab: 128, ac: 2 },
  },
  '3gp': {
    id: '3gp',
    label: '3gp',
    extension: '3gp',
    defaultPreset: '320x240',
    presets: Object.fromEntries(VIDEO_RESOLUTIONS.map((r) => [r.id, r])),
    vcodecs: ['h264', 'mpeg4'],
    acodecs: ['aac'],
    defaults: { vcodec: 'mpeg4', acodec: 'aac', ab: 128, ac: 2 },
  },
  mpeg: {
    id: 'mpeg',
    label: 'mpeg',
    extension: 'mpg',
    defaultPreset: 'same',
    presets: Object.fromEntries(VIDEO_RESOLUTIONS.map((r) => [r.id, r])),
    vcodecs: ['mpeg1', 'mpeg2'],
    acodecs: ['mp2'],
    defaults: { vcodec: 'mpeg2', acodec: 'mp2', ab: 128, ac: 2 },
  },
};

export const AUDIO_PRESETS: PresetItem[] = [
  { id: 'economy', name: 'Economy', name2: '64 kbps', ab: 64, ac: 1 },
  { id: 'standard', name: 'Standard', name2: '128 kbps', ab: 128, ac: 2 },
  { id: 'good', name: 'Good', name2: '192 kbps', ab: 192, ac: 2 },
  { id: 'best', name: 'Best', name2: '320 kbps', ab: 320, ac: 2 },
];

export const AUDIO_FORMATS: Record<string, FormatConfig> = {
  mp3: {
    id: 'mp3',
    label: 'mp3',
    extension: 'mp3',
    defaultPreset: 'standard',
    presets: Object.fromEntries(AUDIO_PRESETS.map((r) => [r.id, r])),
    defaults: { acodec: 'mp3', ab: 128, ac: 2 },
  },
  wav: {
    id: 'wav',
    label: 'wav',
    extension: 'wav',
    defaultPreset: 'standard',
    presets: Object.fromEntries(AUDIO_PRESETS.map((r) => [r.id, r])),
    defaults: { acodec: 'pcm', ab: 1411, ac: 2 },
  },
  m4a: {
    id: 'm4a',
    label: 'm4a',
    extension: 'm4a',
    defaultPreset: 'standard',
    presets: Object.fromEntries(AUDIO_PRESETS.map((r) => [r.id, r])),
    defaults: { acodec: 'aac', ab: 128, ac: 2 },
  },
  flac: {
    id: 'flac',
    label: 'flac',
    extension: 'flac',
    defaultPreset: 'best',
    presets: Object.fromEntries(AUDIO_PRESETS.map((r) => [r.id, r])),
    defaults: { acodec: 'flac', ab: 320, ac: 2 },
  },
  ogg: {
    id: 'ogg',
    label: 'ogg',
    extension: 'ogg',
    defaultPreset: 'standard',
    presets: Object.fromEntries(AUDIO_PRESETS.map((r) => [r.id, r])),
    defaults: { acodec: 'vorbis', ab: 128, ac: 2 },
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
  flv: 'Flash Video',
  aac: 'AAC',
  mp3: 'MP3',
  mp2: 'MP2',
  vorbis: 'Ogg Vorbis',
  alac: 'Apple Lossless (ALAC)',
  flac: 'FLAC',
  pcm: 'WAV PCM',
};

export interface ConversionOptions {
  mediaType: MediaType;
  format: string;
  preset: string;
  vcodec: string;
  acodec: string;
  noAudio: boolean;
}

export type ConversionPhase = 'idle' | 'uploading' | 'encoding' | 'completed' | 'error';

export interface ConversionResult {
  downloadUrl: string;
  browserFilename: string;
  publicFilename?: string;
  filesize?: number;
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
}
