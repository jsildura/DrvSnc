import React, { useState, useRef } from 'react';
import {
  MediaType,
  VIDEO_FORMATS,
  AUDIO_FORMATS,
  AUDIO_PRESETS,
  CODEC_DISPLAY_NAMES,
  ConversionOptions,
  ConversionState,
  SelectedDriveFile,
} from './types';
import { ResolutionDropdown } from './ResolutionDropdown';
import { DriveVideoPickerModal } from './DriveVideoPickerModal';
import {
  fetchConverterConfig,
  uploadDriveVideoToEncoder,
  startEncodingJob,
} from './converterClient';
import { FolderPicker } from '../components/FolderPicker';
import { createRemoteUploadJob } from '../api/jobs';

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function ConverterPanel() {
  const [selectedFile, setSelectedFile] = useState<SelectedDriveFile | null>(null);
  const [isDrivePickerOpen, setIsDrivePickerOpen] = useState(false);

  // Conversion options
  const [options, setOptions] = useState<ConversionOptions>({
    mediaType: 'video',
    format: 'mp4',
    preset: 'same',
    vcodec: 'h264',
    acodec: 'aac',
    noAudio: false,
  });

  // More formats dropdown open state
  const [isMoreFormatsOpen, setIsMoreFormatsOpen] = useState(false);
  // Settings drawer toggle
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Conversion process state
  const [conversion, setConversion] = useState<ConversionState>({
    phase: 'idle',
    uploadProgress: 0,
    uploadSpeedMb: 0,
    uploadEtaSec: 0,
    encodeProgress: 0,
    statusText: '',
    result: null,
    error: null,
  });

  // Save to Drive state
  const [destinationFolderId, setDestinationFolderId] = useState<string | undefined>(undefined);
  const [destinationFolderName, setDestinationFolderName] = useState('My Drive (Root)');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [savedJobId, setSavedJobId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Abort controller for cancellation
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeSocketCancelRef = useRef<(() => void) | null>(null);

  const currentFormatConfig =
    options.mediaType === 'video'
      ? VIDEO_FORMATS[options.format] || VIDEO_FORMATS.mp4
      : AUDIO_FORMATS[options.format] || AUDIO_FORMATS.mp3;

  // Handle format change
  const handleFormatChange = (fmt: string) => {
    const config =
      options.mediaType === 'video'
        ? VIDEO_FORMATS[fmt] || VIDEO_FORMATS.mp4
        : AUDIO_FORMATS[fmt] || AUDIO_FORMATS.mp3;

    setOptions((prev) => ({
      ...prev,
      format: fmt,
      preset: config.defaultPreset || 'same',
      vcodec: config.defaults.vcodec || config.vcodecs?.[0] || 'h264',
      acodec: config.defaults.acodec || config.acodecs?.[0] || 'aac',
    }));
    setIsMoreFormatsOpen(false);
  };

  // Switch MediaType (video/audio)
  const handleMediaTypeChange = (type: MediaType) => {
    if (type === 'video') {
      setOptions({
        mediaType: 'video',
        format: 'mp4',
        preset: 'same',
        vcodec: 'h264',
        acodec: 'aac',
        noAudio: false,
      });
    } else {
      setOptions({
        mediaType: 'audio',
        format: 'mp3',
        preset: 'standard',
        vcodec: '',
        acodec: 'mp3',
        noAudio: false,
      });
    }
    setIsMoreFormatsOpen(false);
  };

  // Convert execution
  const handleStartConversion = async () => {
    if (!selectedFile) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setConversion({
      phase: 'uploading',
      uploadProgress: 0,
      uploadSpeedMb: 0,
      uploadEtaSec: 0,
      encodeProgress: 0,
      statusText: 'Connecting to converter...',
      result: null,
      error: null,
    });
    setSaveStatus('idle');
    setSaveError(null);

    try {
      // 1. Fetch encoder config
      setConversion((prev) => ({ ...prev, statusText: 'Resolving converter server...' }));
      const config = await fetchConverterConfig();
      const uid = config.uid;

      // 2. Upload Google Drive video to encoder
      setConversion((prev) => ({ ...prev, statusText: 'Streaming video from Google Drive to converter...' }));
      const uploadRes = await uploadDriveVideoToEncoder(
        selectedFile.id,
        selectedFile.name,
        selectedFile.sizeBytes,
        config.sEncoder,
        {
          signal: controller.signal,
          uid,
          onProgress: (info) => {
            setConversion((prev) => ({
              ...prev,
              uploadProgress: info.progressPercent,
              uploadSpeedMb: info.speedMb,
              uploadEtaSec: info.etaSec,
              statusText: `Uploading: ${info.progressPercent}% (${info.speedMb} MB/s, ~${info.etaSec}s remaining)`,
            }));
          },
        }
      );

      // 3. Start Encoding via WebSocket
      setConversion((prev) => ({
        ...prev,
        phase: 'encoding',
        uploadProgress: 100,
        encodeProgress: 0,
        statusText: 'Encoding video with FFmpeg...',
      }));

      const job = startEncodingJob(
        config.sEncoder,
        uploadRes.tmpFilename,
        uploadRes.durationInSeconds,
        { ...options, uid },
        {
          onStart: () => {
            setConversion((prev) => ({ ...prev, statusText: 'Encoding started...' }));
          },
          onProgress: (percent) => {
            setConversion((prev) => ({
              ...prev,
              encodeProgress: percent,
              statusText: `Encoding: ${percent}%`,
            }));
          },
          onComplete: (res) => {
            setConversion((prev) => ({
              ...prev,
              phase: 'completed',
              encodeProgress: 100,
              statusText: 'Conversion complete!',
              result: res,
            }));
          },
          onError: (errMsg) => {
            setConversion((prev) => ({
              ...prev,
              phase: 'error',
              error: errMsg,
              statusText: 'Conversion failed',
            }));
          },
        }
      );

      activeSocketCancelRef.current = job.cancel;
    } catch (err) {
      if (!controller.signal.aborted) {
        setConversion((prev) => ({
          ...prev,
          phase: 'error',
          error: (err as Error).message || 'Conversion failed',
          statusText: 'Error',
        }));
      }
    }
  };

  const handleCancelConversion = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (activeSocketCancelRef.current) {
      activeSocketCancelRef.current();
      activeSocketCancelRef.current = null;
    }
    setConversion((prev) => ({
      ...prev,
      phase: 'idle',
      statusText: 'Cancelled',
    }));
  };

  const handleSaveToDrive = async () => {
    if (!conversion.result) return;
    try {
      setSaveStatus('saving');
      setSaveError(null);

      const job = await createRemoteUploadJob({
        url: conversion.result.downloadUrl,
        filename: conversion.result.browserFilename,
        folderId: destinationFolderId,
      });

      setSavedJobId(job.id);
      setSaveStatus('saved');
    } catch (err) {
      setSaveStatus('error');
      setSaveError((err as Error).message || 'Failed to trigger save to Google Drive');
    }
  };

  // Video format buttons
  const primaryVideoFormats = ['mp4', 'avi', 'mov', 'mkv'];
  const moreVideoFormats = ['flv', '3gp', 'webm', 'mpeg'];

  // Audio format buttons
  const primaryAudioFormats = ['mp3', 'wav', 'm4a', 'flac'];
  const moreAudioFormats = ['ogg'];

  return (
    <div className="w-full max-w-3xl mx-auto font-sans">
      {/* Skeuomorphic Metallic Main Card - matching Image 1 & 2 */}
      <div className="relative rounded-3xl p-6 sm:p-8 bg-gradient-to-b from-[#d8dce2] via-[#cfd4dc] to-[#c2c8d2] dark:from-[#2a303c] dark:via-[#212631] dark:to-[#181d26] border border-[#bcc3cf] dark:border-[#384152] shadow-[0_12px_40px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.7)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.08)]">
        {/* Subtle decorative mesh/dots overlay */}
        <div
          className="absolute inset-0 rounded-3xl pointer-events-none opacity-40 dark:opacity-20 bg-[radial-gradient(#a3adba_1px,transparent_1px)] dark:bg-[radial-gradient(#475569_1px,transparent_1px)] [background-size:12px_12px]"
          aria-hidden="true"
        />

        <div className="relative z-10 space-y-7">
          {/* ======================================================== */}
          {/* STEP 1: Select Video from Google Drive                   */}
          {/* ======================================================== */}
          <div className="flex items-start gap-4">
            {/* Number 1 Badge (Beveled Metallic Circle) */}
            <div className="w-10 h-10 rounded-full bg-gradient-to-b from-white/90 via-slate-200 to-slate-300 dark:from-slate-700 dark:via-slate-800 dark:to-slate-900 border border-slate-300 dark:border-slate-600 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),0_2px_4px_rgba(0,0,0,0.1)] flex items-center justify-center font-bold text-base text-slate-600 dark:text-slate-300 shrink-0">
              1
            </div>

            <div className="flex-1 min-w-0 pt-1">
              {!selectedFile ? (
                /* Google Drive Button matching Image 1 */
                <button
                  type="button"
                  onClick={() => setIsDrivePickerOpen(true)}
                  className="group inline-flex items-center gap-2.5 px-4 py-2 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white bg-transparent hover:bg-black/5 dark:hover:bg-white/5 transition-all cursor-pointer"
                >
                  {/* Official Google Drive triangle icon */}
                  <svg className="w-5 h-5" viewBox="0 0 87.3 78" fill="none">
                    <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
                    <path d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44C.4 49.9 0 51.45 0 53h27.5z" fill="#00ac47" />
                    <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 10.15 7.9 13.65z" fill="#ea4335" />
                    <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.4-4.5 1.2z" fill="#00832d" />
                    <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.4 4.5-1.2z" fill="#2684fc" />
                    <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.5c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
                  </svg>
                  <span className="font-medium text-slate-800 dark:text-slate-100">Google Drive</span>
                </button>
              ) : (
                /* Selected File Badge */
                <div className="flex items-center justify-between p-3 rounded-2xl bg-white/70 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 shadow-sm max-w-xl animate-fade-in">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {selectedFile.name}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {formatBytes(selectedFile.sizeBytes)} • Google Drive
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsDrivePickerOpen(true)}
                    className="px-2.5 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg transition-colors"
                  >
                    Change
                  </button>
                </div>
              )}

              {selectedFile && selectedFile.sizeBytes > 1.5 * 1024 * 1024 * 1024 && (
                <div className="mt-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-[11px] flex items-start gap-2 max-w-xl animate-fade-in">
                  <span className="font-bold">⚠️ Advisory:</span>
                  <span>
                    This video is large ({formatBytes(selectedFile.sizeBytes)}). Free cloud encoders typically have a 1.5–2 GB limit. If conversion times out, consider choosing a lower resolution or extracting audio.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ======================================================== */}
          {/* STEP 2: Format & Resolution Selector                      */}
          {/* ======================================================== */}
          <div className="flex items-start gap-4">
            {/* Number 2 Badge */}
            <div className="w-10 h-10 rounded-full bg-gradient-to-b from-white/90 via-slate-200 to-slate-300 dark:from-slate-700 dark:via-slate-800 dark:to-slate-900 border border-slate-300 dark:border-slate-600 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),0_2px_4px_rgba(0,0,0,0.1)] flex items-center justify-center font-bold text-base text-slate-600 dark:text-slate-300 shrink-0">
              2
            </div>

            <div className="flex-1 min-w-0 space-y-4">
              {/* Media Type Tabs + Format Selector Container */}
              <div className="inline-block max-w-full">
                {/* Tabs: Video / Audio matching Image 1 */}
                <div className="flex items-end gap-1">
                  <button
                    type="button"
                    onClick={() => handleMediaTypeChange('video')}
                    className={`px-6 py-2 rounded-t-xl text-xs font-bold transition-all ${
                      options.mediaType === 'video'
                        ? 'bg-[#5582a8] text-white shadow-sm'
                        : 'bg-[#b6bdc8] dark:bg-[#343b47] text-slate-700 dark:text-slate-300 hover:bg-[#a8b0bd]'
                    }`}
                  >
                    Video
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMediaTypeChange('audio')}
                    className={`px-6 py-2 rounded-t-xl text-xs font-bold transition-all ${
                      options.mediaType === 'audio'
                        ? 'bg-[#5582a8] text-white shadow-sm'
                        : 'bg-[#b6bdc8] dark:bg-[#343b47] text-slate-700 dark:text-slate-300 hover:bg-[#a8b0bd]'
                    }`}
                  >
                    Audio
                  </button>
                </div>

                {/* Tab Content Box with Segmented Format Buttons */}
                <div className="bg-[#5582a8] p-2.5 rounded-b-2xl rounded-tr-2xl shadow-md">
                  <div className="flex items-center rounded-xl bg-white/95 dark:bg-slate-900 border border-slate-300/80 dark:border-slate-700 overflow-hidden shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]">
                    {/* Primary Format Buttons */}
                    {(options.mediaType === 'video' ? primaryVideoFormats : primaryAudioFormats).map(
                      (fmt) => {
                        const isSelected = options.format === fmt;
                        return (
                          <button
                            key={fmt}
                            type="button"
                            onClick={() => handleFormatChange(fmt)}
                            className={`flex-1 min-w-[58px] py-1.5 px-3 text-xs font-bold transition-all border-r last:border-r-0 border-slate-200 dark:border-slate-800 ${
                              isSelected
                                ? 'bg-gradient-to-b from-[#5c6877] to-[#45505e] text-white shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]'
                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            {fmt}
                          </button>
                        );
                      }
                    )}

                    {/* More Formats Dropdown Button */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setIsMoreFormatsOpen(!isMoreFormatsOpen)}
                        className={`flex items-center gap-1.5 py-1.5 px-3 text-xs font-bold transition-all ${
                          (options.mediaType === 'video' ? moreVideoFormats : moreAudioFormats).includes(
                            options.format
                          )
                            ? 'bg-gradient-to-b from-[#5c6877] to-[#45505e] text-white'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span>
                          {(options.mediaType === 'video' ? moreVideoFormats : moreAudioFormats).includes(
                            options.format
                          )
                            ? options.format
                            : 'more'}
                        </span>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                        </svg>
                      </button>

                      {/* Popup of More Formats */}
                      {isMoreFormatsOpen && (
                        <div className="absolute right-0 top-full mt-1 w-32 bg-white dark:bg-slate-850 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-1 z-30 animate-fade-in">
                          {(options.mediaType === 'video' ? moreVideoFormats : moreAudioFormats).map(
                            (fmt) => (
                              <button
                                key={fmt}
                                type="button"
                                onClick={() => handleFormatChange(fmt)}
                                className={`w-full text-left px-3 py-1.5 text-xs font-bold transition-colors ${
                                  options.format === fmt
                                    ? 'bg-indigo-600 text-white'
                                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                              >
                                {fmt}
                              </button>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Resolution / Quality & Settings Controls */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {options.mediaType === 'video' ? (
                  /* Video Resolution Dropdown (matching Image 1 & 2) */
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      Resolution:
                    </span>
                    <ResolutionDropdown
                      selectedPresetId={options.preset}
                      onSelectPreset={(p) => setOptions((prev) => ({ ...prev, preset: p }))}
                    />
                  </div>
                ) : (
                  /* Audio Quality Dropdown */
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      Quality:
                    </span>
                    <select
                      value={options.preset}
                      onChange={(e) => setOptions((prev) => ({ ...prev, preset: e.target.value }))}
                      className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-gradient-to-b from-white to-slate-100 dark:from-slate-800 dark:to-slate-850 border border-slate-300 dark:border-slate-700 rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] focus:outline-none"
                    >
                      {AUDIO_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.name2})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Settings Button matching Image 1 */}
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                  className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-xl border border-slate-300 dark:border-slate-700 transition-all ${
                    isSettingsOpen
                      ? 'bg-gradient-to-b from-[#5c6877] to-[#45505e] text-white shadow-inner'
                      : 'bg-gradient-to-b from-white to-slate-100 dark:from-slate-800 dark:to-slate-850 text-slate-700 dark:text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_1px_2px_rgba(0,0,0,0.08)] hover:from-slate-50 hover:to-slate-150'
                  }`}
                >
                  <span>Settings</span>
                </button>
              </div>

              {/* Advanced Settings Drawer */}
              {isSettingsOpen && (
                <div className="p-4 rounded-2xl bg-white/70 dark:bg-slate-900/80 border border-slate-300/80 dark:border-slate-700/80 shadow-sm space-y-3 animate-fade-in text-xs max-w-lg">
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      Advanced Conversion Settings
                    </span>
                  </div>

                  {options.mediaType === 'video' && currentFormatConfig.vcodecs && (
                    <div className="flex items-center justify-between gap-4">
                      <label htmlFor="video-codec-select" className="text-slate-600 dark:text-slate-400 font-medium">
                        Video Codec:
                      </label>
                      <select
                        id="video-codec-select"
                        aria-label="Video Codec"
                        value={options.vcodec}
                        onChange={(e) => setOptions((prev) => ({ ...prev, vcodec: e.target.value }))}
                        className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                      >
                        {currentFormatConfig.vcodecs.map((c) => (
                          <option key={c} value={c}>
                            {CODEC_DISPLAY_NAMES[c] || c}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {!options.noAudio && currentFormatConfig.acodecs && (
                    <div className="flex items-center justify-between gap-4">
                      <label htmlFor="audio-codec-select" className="text-slate-600 dark:text-slate-400 font-medium">
                        Audio Codec:
                      </label>
                      <select
                        id="audio-codec-select"
                        aria-label="Audio Codec"
                        value={options.acodec}
                        onChange={(e) => setOptions((prev) => ({ ...prev, acodec: e.target.value }))}
                        className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                      >
                        {currentFormatConfig.acodecs.map((c) => (
                          <option key={c} value={c}>
                            {CODEC_DISPLAY_NAMES[c] || c}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {options.mediaType === 'video' && (
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="checkbox"
                        id="no_audio"
                        checked={options.noAudio}
                        onChange={(e) => setOptions((prev) => ({ ...prev, noAudio: e.target.checked }))}
                        className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500"
                      />
                      <label htmlFor="no_audio" className="text-slate-700 dark:text-slate-300 font-medium cursor-pointer">
                        No audio (remove audio track)
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ======================================================== */}
          {/* STEP 3: Convert Action & Progress UI                     */}
          {/* ======================================================== */}
          <div className="pt-2 border-t border-slate-300/60 dark:border-slate-700/60">
            {conversion.phase === 'idle' && (
              /* Big prominent Convert button as in Image 2 */
              <button
                type="button"
                disabled={!selectedFile}
                onClick={handleStartConversion}
                className="px-8 py-3 rounded-2xl font-bold text-base text-white bg-gradient-to-b from-[#5c8db6] via-[#4878a0] to-[#3b668a] hover:from-[#6597c2] hover:to-[#416f96] active:shadow-inner border border-[#3b6385] shadow-[0_4px_12px_rgba(40,80,120,0.3),inset_0_1px_0_rgba(255,255,255,0.4)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all transform active:scale-98"
              >
                Convert
              </button>
            )}

            {(conversion.phase === 'uploading' || conversion.phase === 'encoding') && (
              <div className="p-5 rounded-2xl bg-white/80 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-700 shadow-md space-y-3 animate-fade-in">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200">
                    <svg className="w-4 h-4 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>{conversion.statusText}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCancelConversion}
                    className="text-red-500 hover:text-red-600 font-bold hover:underline"
                  >
                    Cancel
                  </button>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-3 overflow-hidden shadow-inner">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 via-sky-500 to-indigo-600 transition-all duration-300 rounded-full"
                    style={{
                      width: `${
                        conversion.phase === 'uploading'
                          ? conversion.uploadProgress * 0.5
                          : 50 + conversion.encodeProgress * 0.5
                      }%`,
                    }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span>
                    Phase: {conversion.phase === 'uploading' ? '1. Uploading to Converter' : '2. FFmpeg Encoding'}
                  </span>
                  <span>
                    {conversion.phase === 'uploading'
                      ? `${conversion.uploadProgress}%`
                      : `${conversion.encodeProgress}%`}
                  </span>
                </div>
              </div>
            )}

            {conversion.phase === 'error' && (
              <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-300 text-xs flex items-start justify-between gap-3 animate-fade-in">
                <div>
                  <p className="font-bold">Conversion Error</p>
                  <p className="mt-0.5">{conversion.error || 'Something went wrong during conversion.'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setConversion((prev) => ({ ...prev, phase: 'idle' }))}
                  className="px-3 py-1 font-semibold rounded-lg bg-white dark:bg-slate-800 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300"
                >
                  Try Again
                </button>
              </div>
            )}

            {conversion.phase === 'completed' && conversion.result && (
              <div className="p-5 rounded-2xl bg-white/90 dark:bg-slate-900/90 border border-emerald-500/40 shadow-lg space-y-4 animate-fade-in">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      Your converted file is ready!
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {conversion.result.browserFilename}
                    </p>
                  </div>
                </div>

                {/* Save to Google Drive Box */}
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Save to Google Drive:
                    </span>
                  </div>

                  <FolderPicker
                    selectedFolderId={destinationFolderId}
                    selectedFolderName={destinationFolderName}
                    onSelect={(id, name) => {
                      setDestinationFolderId(id);
                      setDestinationFolderName(name);
                    }}
                  />

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={saveStatus === 'saving' || saveStatus === 'saved'}
                      onClick={handleSaveToDrive}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50 transition-colors flex items-center gap-2 cursor-pointer"
                    >
                      {saveStatus === 'saving' ? (
                        <>
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          <span>Saving to Drive...</span>
                        </>
                      ) : saveStatus === 'saved' ? (
                        <>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Saved to Google Drive!</span>
                        </>
                      ) : (
                        <span>Save to Google Drive</span>
                      )}
                    </button>

                    {/* Direct Download via proxy to bypass hotlink 403 */}
                    <a
                      href={`/api/v1/converter/download?url=${encodeURIComponent(conversion.result.downloadUrl)}`}
                      download={conversion.result.browserFilename}
                      className="px-4 py-2 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
                    >
                      Download to Computer
                    </a>
                  </div>

                  {saveStatus === 'saved' && (
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                      File saved to your Google Drive! Check your Drive or the Uploads tab for transfer status.
                    </p>
                  )}

                  {saveStatus === 'error' && (
                    <p className="text-[11px] text-red-500 font-medium">{saveError}</p>
                  )}
                </div>

                <div className="pt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setConversion({
                        phase: 'idle',
                        uploadProgress: 0,
                        uploadSpeedMb: 0,
                        uploadEtaSec: 0,
                        encodeProgress: 0,
                        statusText: '',
                        result: null,
                        error: null,
                      });
                      setSelectedFile(null);
                    }}
                    className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white underline cursor-pointer"
                  >
                    Convert another video
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Google Drive Video File Picker Modal */}
      <DriveVideoPickerModal
        isOpen={isDrivePickerOpen}
        onClose={() => setIsDrivePickerOpen(false)}
        onSelect={(file) => {
          setSelectedFile(file);
          if (file.parentFolderId) {
            setDestinationFolderId(file.parentFolderId);
          }
        }}
      />
    </div>
  );
}
