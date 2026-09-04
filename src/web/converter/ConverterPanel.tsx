import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  MediaType,
  VIDEO_FORMATS,
  AUDIO_FORMATS,
  AUDIO_PRESETS,
  DOCUMENT_FORMATS,
  PRIMARY_DOCUMENT_FORMAT_KEYS,
  CODEC_DISPLAY_NAMES,
  ConversionOptions,
  ConversionState,
  SelectedDriveFile,
  THREEGP_RESOLUTIONS,
  VIDEO_RESOLUTIONS,
  AudioAdvancedOptions,
  TrackInfo,
} from './types';
import { ResolutionDropdown } from './ResolutionDropdown';
import { DriveVideoPickerModal } from './DriveVideoPickerModal';
import { AudioQualitySlider } from './AudioQualitySlider';
import { AudioAdvancedSettings } from './AudioAdvancedSettings';
import { AudioTrackInfoDrawer } from './AudioTrackInfoDrawer';
import { VideoFilesizeSlider } from './VideoFilesizeSlider';
import { calculateSliderBounds } from './filesizeEstimator';
import {
  fetchConverterConfig,
  createStreamTicket,
  importRemoteVideoToEncoder,
  uploadDriveVideoToEncoder,
  startEncodingJob,
  UploadResult,
} from './converterClient';
import { FolderPicker } from '../components/FolderPicker';
import { createRemoteUploadJob } from '../api/jobs';
import { useOptionalApp } from '../state/AppProvider';

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export interface ConverterPanelProps {
  initialFile?: SelectedDriveFile | null;
}

export function ConverterPanel({ initialFile }: ConverterPanelProps = {}) {
  const app = useOptionalApp();
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

  // Audio advanced & track info state
  const [isAudioAdvancedOpen, setIsAudioAdvancedOpen] = useState(false);
  const [isAudioTrackInfoOpen, setIsAudioTrackInfoOpen] = useState(false);

  const [audioAdvanced, setAudioAdvanced] = useState<AudioAdvancedOptions>({
    bitrateType: 'constant',
    constantBitrate: 128,
    variableBitrate: 5,
    sampleRate: 44100,
    channels: 2,
    fadeIn: false,
    fadeOut: false,
    reverse: false,
  });

  const [trackInfo, setTrackInfo] = useState<TrackInfo>({
    setTag: false,
    title: '',
    artist: '',
    album: '',
    year: '',
    genre: '',
    comment: '',
  });

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const selectedFileRef = useRef(selectedFile);
  selectedFileRef.current = selectedFile;
  const trackInfoRef = useRef(trackInfo);
  trackInfoRef.current = trackInfo;

  // More formats dropdown open state & dropdown container ref
  const [isMoreFormatsOpen, setIsMoreFormatsOpen] = useState(false);
  const moreDropdownRef = useRef<HTMLDivElement>(null);

  // Responsive check for mobile screen width (< 640px)
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 640;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      setIsMobile(window.innerWidth < 640);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Close more dropdown when clicking outside
  useEffect(() => {
    if (!isMoreFormatsOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (moreDropdownRef.current && !moreDropdownRef.current.contains(e.target as Node)) {
        setIsMoreFormatsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMoreFormatsOpen]);

  // Settings drawer toggle
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Target filesize in MB state
  const [customTargetMb, setCustomTargetMb] = useState<number | null>(null);

  // Reset custom target size when selected file changes
  useEffect(() => {
    setCustomTargetMb(null);
  }, [selectedFile?.id]);

  const currentPresetVb = useMemo(() => {
    const preset = VIDEO_RESOLUTIONS.find((r) => r.id === options.preset);
    return preset?.vb || 4500;
  }, [options.preset]);

  const currentResolutionDimensions = useMemo(() => {
    const preset = VIDEO_RESOLUTIONS.find((r) => r.id === options.preset);
    if (preset && preset.width && preset.height) {
      return { width: preset.width, height: preset.height };
    }
    if (selectedFile?.videoMetadata?.width && selectedFile?.videoMetadata?.height) {
      return {
        width: selectedFile.videoMetadata.width,
        height: selectedFile.videoMetadata.height,
      };
    }
    return { width: 1280, height: 720 };
  }, [options.preset, selectedFile]);

  const sliderBounds = useMemo(() => {
    return calculateSliderBounds({
      sourceSizeBytes: selectedFile?.sizeBytes,
      durationMillis: selectedFile?.videoMetadata?.durationMillis,
      width: currentResolutionDimensions.width,
      height: currentResolutionDimensions.height,
      presetVb: currentPresetVb,
      noAudio: options.noAudio,
      audioBitrateKbps: 128,
    });
  }, [selectedFile, currentResolutionDimensions, currentPresetVb, options.noAudio]);

  const activeTargetMb = customTargetMb ?? sliderBounds.defaultMb;

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
  const [sessionUid, setSessionUid] = useState<string>('');

  // Abort controller for cancellation
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeSocketCancelRef = useRef<(() => void) | null>(null);

  const currentFormatConfig =
    options.mediaType === 'video'
      ? VIDEO_FORMATS[options.format] || VIDEO_FORMATS.mp4
      : options.mediaType === 'audio'
      ? AUDIO_FORMATS[options.format] || AUDIO_FORMATS.mp3
      : (DOCUMENT_FORMATS[options.format] as any);

  // Handle format change
  const handleFormatChange = (fmt: string) => {
    if (options.mediaType === 'video') {
      const config = VIDEO_FORMATS[fmt] || VIDEO_FORMATS.mp4;
      setOptions((prev) => ({
        ...prev,
        format: fmt,
        preset: config.defaultPreset || (fmt === '3gp' ? '176x144' : 'same'),
        vcodec: config.defaults.vcodec || config.vcodecs?.[0] || 'h264',
        acodec: config.defaults.acodec || config.acodecs?.[0] || 'aac',
      }));
    } else if (options.mediaType === 'audio') {
      const config = AUDIO_FORMATS[fmt] || AUDIO_FORMATS.mp3;
      const defaultPreset = config.defaultPreset || 'second';
      const defaultAb = config.defaults.ab || 128;
      const defaultAr = config.defaults.ar || 44100;
      const defaultAc = config.defaults.ac || 2;
      const updatedAdvanced: AudioAdvancedOptions = {
        ...audioAdvanced,
        constantBitrate: defaultAb,
        sampleRate: defaultAr,
        channels: defaultAc,
      };
      setAudioAdvanced(updatedAdvanced);
      setOptions((prev) => ({
        ...prev,
        format: fmt,
        preset: defaultPreset,
        vcodec: '',
        acodec: config.defaults.acodec || 'mp3',
        audioAdvanced: updatedAdvanced,
        trackInfo: trackInfo.setTag ? trackInfo : undefined,
      }));
    } else {
      const sourceExt = selectedFile?.name ? selectedFile.name.split('.').pop()?.toLowerCase() : options.convertFrom || 'pdf';
      setOptions((prev) => ({
        ...prev,
        format: fmt,
        convertFrom: sourceExt || prev.convertFrom || 'pdf',
      }));
    }
    setIsMoreFormatsOpen(false);
  };

  // Switch MediaType (video/audio/document)
  const handleMediaTypeChange = useCallback((type: MediaType, sourceFile?: SelectedDriveFile | null) => {
    const currentFile = sourceFile !== undefined ? sourceFile : selectedFileRef.current;
    if (type === 'video') {
      setOptions({
        mediaType: 'video',
        format: 'mp4',
        preset: 'same',
        vcodec: 'h264',
        acodec: 'aac',
        noAudio: false,
      });
      setIsAudioAdvancedOpen(false);
      setIsAudioTrackInfoOpen(false);
    } else if (type === 'audio') {
      const config = AUDIO_FORMATS.mp3;
      const defaultAb = config.defaults.ab || 128;
      const defaultAr = config.defaults.ar || 44100;
      const defaultAc = config.defaults.ac || 2;
      const initialAdvanced: AudioAdvancedOptions = {
        bitrateType: 'constant',
        constantBitrate: defaultAb,
        variableBitrate: 5,
        sampleRate: defaultAr,
        channels: defaultAc,
        fadeIn: false,
        fadeOut: false,
        reverse: false,
      };
      setAudioAdvanced(initialAdvanced);
      setOptions({
        mediaType: 'audio',
        format: 'mp3',
        preset: 'second',
        vcodec: '',
        acodec: 'mp3',
        noAudio: false,
        audioAdvanced: initialAdvanced,
        trackInfo: trackInfoRef.current.setTag ? trackInfoRef.current : undefined,
      });
      setIsSettingsOpen(false);
    } else {
      const sourceExt = currentFile?.name ? currentFile.name.split('.').pop()?.toLowerCase() : 'pdf';
      setOptions({
        mediaType: 'document',
        format: sourceExt === 'pdf' ? 'docx' : 'pdf',
        preset: 'default',
        vcodec: '',
        acodec: '',
        noAudio: false,
        convertFrom: sourceExt || 'pdf',
      });
      setIsAudioAdvancedOpen(false);
      setIsAudioTrackInfoOpen(false);
      setIsSettingsOpen(false);
    }
    setIsMoreFormatsOpen(false);
  }, []);

  const selectFile = useCallback(
    (file: SelectedDriveFile) => {
      setSelectedFile(file);
      const fileExt = file.name.split('.').pop()?.toLowerCase() || '';
      const DOC_EXTS = /\.(pdf|docx?|txt|rtf|odt|html?|epub|mobi|xlsx?|pptx?|csv)$/i;
      const AUDIO_EXTS = /\.(mp3|wav|m4a|m4r|flac|ogg|mp2|amr|aac|wma|aiff|opus)$/i;

      const isDoc =
        DOC_EXTS.test(file.name) ||
        file.mimeType?.startsWith('application/pdf') ||
        file.mimeType?.includes('document') ||
        file.mimeType?.includes('spreadsheet') ||
        file.mimeType?.includes('presentation') ||
        file.mimeType?.startsWith('text/');

      const isAudio =
        AUDIO_EXTS.test(file.name) ||
        file.mimeType?.startsWith('audio/');

      if (isDoc) {
        if (optionsRef.current.mediaType !== 'document') {
          handleMediaTypeChange('document', file);
        } else {
          setOptions((prev) => ({
            ...prev,
            convertFrom: fileExt || 'pdf',
            format: fileExt === 'pdf' ? (prev.format === 'pdf' ? 'docx' : prev.format) : (prev.format === fileExt ? 'pdf' : prev.format),
          }));
        }
      } else if (isAudio) {
        if (optionsRef.current.mediaType !== 'audio') {
          handleMediaTypeChange('audio', file);
        }
      } else {
        // Video or default
        if (optionsRef.current.mediaType !== 'video') {
          handleMediaTypeChange('video', file);
        }
      }

      if (file.parentFolderId) {
        setDestinationFolderId(file.parentFolderId);
      }
    },
    [handleMediaTypeChange]
  );

  const hasLoadedInitialRef = useRef(false);

  useEffect(() => {
    let preselected: SelectedDriveFile | null = null;

    if (app?.pendingConverterFile) {
      preselected = app.pendingConverterFile;
      app.setPendingConverterFile(null);
    } else if (!hasLoadedInitialRef.current) {
      if (initialFile) {
        preselected = initialFile;
      } else if (typeof sessionStorage !== 'undefined') {
        try {
          const stored = sessionStorage.getItem('gdu_pending_converter_file');
          if (stored) {
            sessionStorage.removeItem('gdu_pending_converter_file');
            preselected = JSON.parse(stored) as SelectedDriveFile;
          }
        } catch {
          // ignore
        }
      }
      hasLoadedInitialRef.current = true;
    }

    if (preselected && preselected.id) {
      selectFile(preselected);
    }
  }, [app, initialFile, selectFile]);

  // Audio specific handlers
  const handleAudioPresetChange = (presetKey: 'first' | 'second' | 'third' | 'fourth') => {
    const audioCfg = AUDIO_FORMATS[options.format] || AUDIO_FORMATS.mp3;
    const presetObj = audioCfg.presets?.[presetKey];
    const newAb = presetObj?.ab ?? audioAdvanced.constantBitrate;
    const newAr = presetObj?.ar ?? audioAdvanced.sampleRate;
    const newAc = presetObj?.ac ?? audioAdvanced.channels;

    const updatedAdvanced: AudioAdvancedOptions = {
      ...audioAdvanced,
      constantBitrate: newAb,
      sampleRate: newAr,
      channels: newAc,
    };

    setAudioAdvanced(updatedAdvanced);
    setOptions((prev) => ({
      ...prev,
      preset: presetKey,
      audioAdvanced: updatedAdvanced,
    }));
  };

  const handleUpdateAudioAdvanced = (updated: Partial<AudioAdvancedOptions>) => {
    setAudioAdvanced((prev) => {
      const next = { ...prev, ...updated };
      setOptions((optPrev) => ({
        ...optPrev,
        audioAdvanced: next,
      }));
      return next;
    });
  };

  const handleUpdateTrackInfo = (updated: Partial<TrackInfo>) => {
    setTrackInfo((prev) => {
      const next = { ...prev, ...updated, setTag: true };
      setOptions((optPrev) => ({
        ...optPrev,
        trackInfo: next,
      }));
      return next;
    });
  };

  const handleClearTrackInfo = () => {
    const empty: TrackInfo = {
      setTag: false,
      title: '',
      artist: '',
      album: '',
      year: '',
      genre: '',
      comment: '',
    };
    setTrackInfo(empty);
    setOptions((optPrev) => ({
      ...optPrev,
      trackInfo: empty,
    }));
  };

  const toggleAudioAdvanced = () => {
    setIsAudioAdvancedOpen((prev) => {
      const next = !prev;
      if (next) setIsAudioTrackInfoOpen(false);
      return next;
    });
  };

  const toggleAudioTrackInfo = () => {
    setIsAudioTrackInfoOpen((prev) => {
      const next = !prev;
      if (next) setIsAudioAdvancedOpen(false);
      return next;
    });
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
      setConversion((prev) => ({ ...prev, statusText: 'Connecting to converter...' }));
      const config = await fetchConverterConfig(options.mediaType);
      const uid = config.uid;
      if (uid) setSessionUid(uid);

      let uploadRes: UploadResult | null = null;

      const isLocalhost =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' ||
          window.location.hostname === '127.0.0.1' ||
          window.location.hostname === '::1');

      // 2. Transfer Google Drive media to encoder
      // In production (!isLocalhost and public streamUrl): Attempt direct remote streaming (server-to-server)
      // In local dev, or if direct stream fails (e.g. bad_url): seamlessly transfer via upload
      if (!isLocalhost) {
        try {
          setConversion((prev) => ({
            ...prev,
            statusText: 'Connecting to Google Drive...',
          }));

          const ticketRes = await createStreamTicket(selectedFile.id, selectedFile.name);
          if (controller.signal.aborted) throw new Error('Conversion cancelled');

          const isStreamLocalhost =
            ticketRes.streamUrl.includes('localhost') ||
            ticketRes.streamUrl.includes('127.0.0.1') ||
            ticketRes.streamUrl.includes('::1');

          if (!isStreamLocalhost) {
            setConversion((prev) => ({
              ...prev,
              statusText: 'Transferring file to converter...',
            }));

            const remoteTask = importRemoteVideoToEncoder(
              config.sEncoder,
              ticketRes.streamUrl,
              selectedFile.name,
              {
                uid,
                mediaType: options.mediaType,
                signal: controller.signal,
                onProgress: (percent) => {
                  setConversion((prev) => ({
                    ...prev,
                    uploadProgress: percent,
                    statusText: `Transferring: ${percent}%`,
                  }));
                },
              }
            );

            activeSocketCancelRef.current = remoteTask.cancel;
            uploadRes = await remoteTask.promise;
          }
        } catch (remoteErr) {
          if (controller.signal.aborted) throw remoteErr;

          // Fallback to upload if remote direct fetch fails (e.g. bad_url)
          console.warn('Remote direct transfer failed, falling back to upload:', remoteErr);
        }
      }

      if (!uploadRes) {
        setConversion((prev) => ({
          ...prev,
          uploadProgress: 0,
          statusText: 'Transferring file to converter...',
        }));

        uploadRes = await uploadDriveVideoToEncoder(
          selectedFile.id,
          selectedFile.name,
          selectedFile.sizeBytes,
          config.sEncoder,
          {
            signal: controller.signal,
            uid,
            mediaType: options.mediaType,
            onProgress: (info) => {
              setConversion((prev) => ({
                ...prev,
                uploadProgress: info.progressPercent,
                uploadSpeedMb: info.speedMb,
                uploadEtaSec: info.etaSec,
                statusText: `Transferring: ${info.progressPercent}% (${info.speedMb} MB/s, ~${info.etaSec}s remaining)`,
              }));
            },
          }
        );
      }

      // 3. Start Encoding / Processing
      setConversion((prev) => ({
        ...prev,
        phase: 'encoding',
        uploadProgress: 100,
        encodeProgress: 0,
        statusText:
          options.mediaType === 'audio'
            ? 'Converting audio...'
            : options.mediaType === 'document'
            ? 'Converting document...'
            : 'Converting video...',
      }));

      const actualDocSourceExt = selectedFile?.name
        ? selectedFile.name.split('.').pop()?.toLowerCase() || 'pdf'
        : options.convertFrom || 'pdf';

      const job = startEncodingJob(
        config.sEncoder,
        uploadRes.tmpFilename,
        uploadRes.durationInSeconds,
        {
          ...options,
          uid,
          convertFrom: actualDocSourceExt,
          originalFilename: selectedFile.name,
        },
        {
          onStart: () => {
            setConversion((prev) => ({ ...prev, statusText: 'Converting...' }));
          },
          onProgress: (percent) => {
            setConversion((prev) => ({
              ...prev,
              encodeProgress: percent,
              statusText: `Converting: ${percent}%`,
            }));
          },
          onComplete: (res) => {
            setConversion((prev) => ({
              ...prev,
              phase: 'completed',
              encodeProgress: 100,
              statusText: 'Conversion complete!',
              result: { ...res, uid: uid || sessionUid },
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

  // Video format buttons: responsive split for mobile (< 640px) vs desktop
  const desktopPrimaryVideoFormats = ['mp4', 'avi', 'mpeg', 'mov', 'flv', '3gp', 'webm', 'mkv', 'wmv'];
  const desktopMoreVideoFormats = ['Apple', 'Android'];

  const mobilePrimaryVideoFormats = ['mp4', 'avi', 'mov', 'mpeg', 'flv'];
  const mobileMoreVideoFormats = ['3gp', 'webm', 'mkv', 'wmv', 'Apple', 'Android'];

  // Audio format buttons: responsive split for mobile (< 640px) vs desktop
  // Desktop: mp3, wav, m4r ("iPhone ringtone"), m4a, flac, ogg. More: mp2, amr
  const desktopPrimaryAudioFormats = ['mp3', 'wav', 'm4r', 'm4a', 'flac', 'ogg'];
  const desktopMoreAudioFormats = ['mp2', 'amr'];

  const mobilePrimaryAudioFormats = ['mp3', 'wav', 'm4r', 'm4a', 'flac'];
  const mobileMoreAudioFormats = ['ogg', 'mp2', 'amr'];

  // Document format buttons
  const desktopPrimaryDocumentFormats = ['pdf', 'docx', 'txt', 'rtf', 'odt'];
  const desktopMoreDocumentFormats = ['doc', 'html', 'epub', 'xlsx', 'xls', 'pptx', 'ppt', 'csv', 'mobi'];

  const mobilePrimaryDocumentFormats = ['pdf', 'docx', 'txt', 'rtf', 'odt'];
  const mobileMoreDocumentFormats = ['doc', 'html', 'epub', 'xlsx', 'xls', 'pptx', 'ppt', 'csv', 'mobi'];

  const currentPrimaryFormats =
    options.mediaType === 'video'
      ? (isMobile ? mobilePrimaryVideoFormats : desktopPrimaryVideoFormats)
      : options.mediaType === 'audio'
      ? (isMobile ? mobilePrimaryAudioFormats : desktopPrimaryAudioFormats)
      : (isMobile ? mobilePrimaryDocumentFormats : desktopPrimaryDocumentFormats);

  const currentMoreFormats =
    options.mediaType === 'video'
      ? (isMobile ? mobileMoreVideoFormats : desktopMoreVideoFormats)
      : options.mediaType === 'audio'
      ? (isMobile ? mobileMoreAudioFormats : desktopMoreAudioFormats)
      : (isMobile ? mobileMoreDocumentFormats : desktopMoreDocumentFormats);

  const getFormatDisplayLabel = (fmt: string) => {
    if (options.mediaType === 'audio') {
      return AUDIO_FORMATS[fmt]?.label || fmt;
    }
    if (options.mediaType === 'document') {
      return DOCUMENT_FORMATS[fmt]?.label || fmt;
    }
    return fmt;
  };

  return (
    <div className="w-full max-w-3xl mx-auto font-sans">
      {/* Skeuomorphic Metallic Main Card - matching Image 1 & 2 */}
      <div className="relative rounded-3xl p-4 sm:p-6 md:p-8 bg-gradient-to-b from-[#d8dce2] via-[#cfd4dc] to-[#c2c8d2] dark:from-[#2a303c] dark:via-[#212631] dark:to-[#181d26] border border-[#bcc3cf] dark:border-[#384152] shadow-[0_12px_40px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.7)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.08)]">
        {/* Subtle decorative mesh/dots overlay */}
        <div
          className="absolute inset-0 rounded-3xl pointer-events-none opacity-40 dark:opacity-20 bg-[radial-gradient(#a3adba_1px,transparent_1px)] dark:bg-[radial-gradient(#475569_1px,transparent_1px)] [background-size:12px_12px]"
          aria-hidden="true"
        />

        <div className="relative z-10 space-y-7">
          {/* ======================================================== */}
          {/* STEP 1: Select Video from Google Drive                   */}
          {/* ======================================================== */}
          <div>
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
                <div className="flex items-center justify-between p-2.5 sm:p-3.5 rounded-2xl sm:rounded-3xl bg-white/85 dark:bg-slate-850/90 border border-slate-200/80 dark:border-slate-700/80 shadow-sm max-w-xl animate-fade-in">
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-indigo-50/80 dark:bg-indigo-950/50 border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-center shrink-0">
                      {selectedFile.mimeType?.startsWith('audio/') ||
                      /\.(mp3|wav|m4a|m4r|flac|ogg|mp2|amr|aac|wma|aiff|opus)$/i.test(selectedFile.name) ? (
                        <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                      ) : /\.(pdf|docx?|txt|rtf|odt|html?|epub|mobi|xlsx?|pptx?|csv)$/i.test(selectedFile.name) || options.mediaType === 'document' ? (
                        <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
                          <polygon points="10 8.5 16 12 10 15.5" fill="currentColor" stroke="none" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                        {selectedFile.name}
                      </p>
                      <p className="text-[10.5px] sm:text-[11px] text-slate-500 dark:text-slate-400">
                        {formatBytes(selectedFile.sizeBytes)} • Google Drive
                      </p>
                      <div className="mt-1 sm:mt-1.5">
                        {options.mediaType === 'document' ||
                        (typeof window !== 'undefined' &&
                          window.location.hostname !== 'localhost' &&
                          window.location.hostname !== '127.0.0.1' &&
                          window.location.hostname !== '::1') ? (
                          <span className="inline-flex items-center text-[9.5px] sm:text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/50 px-1.5 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800/50 leading-tight">
                            Direct Remote Stream (0 MB Bandwidth)
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[9.5px] sm:text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-950/50 px-1.5 py-0.5 rounded-md border border-blue-200 dark:border-blue-800/50 leading-tight">
                            Local Dev (Direct Chunked Transfer)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsDrivePickerOpen(true)}
                    className="text-xs sm:text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline transition-colors shrink-0 ml-2 sm:ml-4 cursor-pointer"
                  >
                    Change
                  </button>
                </div>
              )}

              {selectedFile && selectedFile.sizeBytes > 1.5 * 1024 * 1024 * 1024 && (
                <div className="mt-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-[11px] flex items-start gap-2 max-w-xl animate-fade-in">
                  <span className="font-bold">⚠️ Advisory:</span>
                  <span>
                    This file is large ({formatBytes(selectedFile.sizeBytes)}). Free cloud encoders typically have a 1.5–2 GB limit. If conversion times out, consider choosing a lower resolution or extracting audio.
                  </span>
                </div>
              )}
          </div>

          {/* ======================================================== */}
          {/* STEP 2: Format & Resolution Selector                      */}
          {/* ======================================================== */}
          <div className="space-y-4">
              {/* Media Type Tabs + Format Selector Container */}
              <div className="inline-block max-w-full">
                {/* Tabs: Video / Audio / Document */}
                <div className="flex items-end gap-1">
                  <button
                    type="button"
                    onClick={() => handleMediaTypeChange('video')}
                    className={`px-4 sm:px-6 py-2 rounded-t-xl text-xs font-bold transition-all ${
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
                    className={`px-4 sm:px-6 py-2 rounded-t-xl text-xs font-bold transition-all ${
                      options.mediaType === 'audio'
                        ? 'bg-[#5582a8] text-white shadow-sm'
                        : 'bg-[#b6bdc8] dark:bg-[#343b47] text-slate-700 dark:text-slate-300 hover:bg-[#a8b0bd]'
                    }`}
                  >
                    Audio
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMediaTypeChange('document')}
                    className={`px-4 sm:px-6 py-2 rounded-t-xl text-xs font-bold transition-all ${
                      options.mediaType === 'document'
                        ? 'bg-[#5582a8] text-white shadow-sm'
                        : 'bg-[#b6bdc8] dark:bg-[#343b47] text-slate-700 dark:text-slate-300 hover:bg-[#a8b0bd]'
                    }`}
                  >
                    Document
                  </button>
                </div>

                {/* Tab Content Box with Segmented Format Buttons */}
                <div className="bg-[#5582a8] p-2 sm:p-2.5 rounded-b-2xl rounded-tr-2xl shadow-md max-w-full">
                  <div className="flex items-center rounded-xl bg-white/95 dark:bg-slate-900 border border-slate-300/80 dark:border-slate-700 shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]">
                    {/* Primary Format Buttons */}
                    {currentPrimaryFormats.map((fmt, index) => {
                      const isSelected = options.format === fmt;
                      const isFirst = index === 0;
                      return (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() => handleFormatChange(fmt)}
                          className={`flex-1 min-w-[46px] sm:min-w-[58px] py-1.5 px-2 sm:px-3 text-[11px] sm:text-xs font-bold transition-all border-r border-slate-200 dark:border-slate-800 ${
                            isFirst ? 'rounded-l-xl' : ''
                          } ${
                            isSelected
                              ? 'bg-gradient-to-b from-[#5c6877] to-[#45505e] text-white shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          {getFormatDisplayLabel(fmt)}
                        </button>
                      );
                    })}

                    {/* More Formats Dropdown Button */}
                    <div className="relative shrink-0" ref={moreDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setIsMoreFormatsOpen(!isMoreFormatsOpen)}
                        className={`flex items-center gap-1.5 py-1.5 px-2.5 sm:px-3 text-[11px] sm:text-xs font-bold transition-all rounded-r-xl ${
                          currentMoreFormats.includes(options.format)
                            ? 'bg-gradient-to-b from-[#5c6877] to-[#45505e] text-white shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span>
                          {currentMoreFormats.includes(options.format)
                            ? getFormatDisplayLabel(options.format)
                            : 'more'}
                        </span>
                        <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                        </svg>
                      </button>

                      {/* Popup of More Formats */}
                      {isMoreFormatsOpen && (
                        <div className="absolute right-0 top-full mt-1.5 w-40 max-h-60 overflow-y-auto bg-white dark:bg-slate-850 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-1 z-50 animate-fade-in divide-y divide-slate-100 dark:divide-slate-700/50">
                          {currentMoreFormats.map((fmt) => (
                            <button
                              key={fmt}
                              type="button"
                              onClick={() => handleFormatChange(fmt)}
                              className={`w-full text-left px-3 py-1.5 text-xs font-bold transition-colors ${
                                options.format === fmt
                                  ? 'bg-indigo-600 text-white'
                                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-750'
                              }`}
                            >
                              {getFormatDisplayLabel(fmt)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Resolution / Quality & Settings Controls */}
              {options.mediaType === 'video' ? (
                <>
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    {/* Video Resolution Dropdown (matching Image 1 & 2) */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        Resolution:
                      </span>
                      <ResolutionDropdown
                        selectedPresetId={options.preset}
                        onSelectPreset={(p) => setOptions((prev) => ({ ...prev, preset: p }))}
                        presets={
                          options.format === '3gp'
                            ? THREEGP_RESOLUTIONS
                            : Object.values(VIDEO_FORMATS[options.format]?.presets || VIDEO_RESOLUTIONS)
                        }
                      />
                    </div>

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

                      {currentFormatConfig.vcodecs && (
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
                            {currentFormatConfig.vcodecs.map((c: string) => (
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
                            {currentFormatConfig.acodecs.map((c: string) => (
                              <option key={c} value={c}>
                                {CODEC_DISPLAY_NAMES[c] || c}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

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

                      {/* Estimated Output File Size Slider matching video-converter.com */}
                      {options.mediaType === 'video' && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                          <VideoFilesizeSlider
                            bounds={sliderBounds}
                            targetMb={activeTargetMb}
                            width={currentResolutionDimensions.width}
                            height={currentResolutionDimensions.height}
                            noAudio={options.noAudio}
                            baseAudioBitrate={128}
                            onChangeTargetMb={(mb) => {
                              setCustomTargetMb(mb);
                              setOptions((prev) => ({ ...prev, targetFilesizeMb: mb }));
                            }}
                            onResetToDefault={() => {
                              setCustomTargetMb(null);
                              setOptions((prev) => {
                                const copy = { ...prev };
                                delete copy.targetFilesizeMb;
                                return copy;
                              });
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : options.mediaType === 'audio' ? (
                /* Audio Quality Slider + Advanced & Track Info Controls matching Image 1 & Image 2 */
                <div className="space-y-4 pt-1 max-w-2xl">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                    {/* Skeuomorphic Quality Slider on Left */}
                    <div className="flex-1 min-w-0">
                      <AudioQualitySlider
                        format={options.format}
                        selectedPreset={options.preset}
                        onSelectPreset={handleAudioPresetChange}
                      />
                    </div>

                    {/* Right-side Action Buttons matching Image 1 */}
                    <div className="flex sm:flex-col items-stretch justify-center gap-2 sm:w-40 shrink-0">
                      <button
                        type="button"
                        onClick={toggleAudioAdvanced}
                        className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-all text-center cursor-pointer ${
                          isAudioAdvancedOpen
                            ? 'bg-gradient-to-b from-[#5c6877] to-[#45505e] text-white border-slate-700 shadow-inner'
                            : 'bg-gradient-to-b from-white to-slate-100 dark:from-slate-800 dark:to-slate-850 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_1px_2px_rgba(0,0,0,0.08)] hover:from-slate-50 hover:to-slate-150'
                        }`}
                      >
                        Advanced settings
                      </button>

                      <button
                        type="button"
                        onClick={toggleAudioTrackInfo}
                        className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-all text-center cursor-pointer ${
                          isAudioTrackInfoOpen
                            ? 'bg-gradient-to-b from-[#5c6877] to-[#45505e] text-white border-slate-700 shadow-inner'
                            : 'bg-gradient-to-b from-white to-slate-100 dark:from-slate-800 dark:to-slate-850 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_1px_2px_rgba(0,0,0,0.08)] hover:from-slate-50 hover:to-slate-150'
                        }`}
                      >
                        Edit track info
                      </button>
                    </div>
                  </div>

                  {/* Expandable Audio Drawers */}
                  {isAudioAdvancedOpen && (
                    <AudioAdvancedSettings
                      format={options.format}
                      options={audioAdvanced}
                      onChange={handleUpdateAudioAdvanced}
                    />
                  )}

                  {isAudioTrackInfoOpen && (
                    <AudioTrackInfoDrawer
                      trackInfo={trackInfo}
                      onChange={handleUpdateTrackInfo}
                      onClear={handleClearTrackInfo}
                    />
                  )}
                </div>
              ) : (
                /* Document Conversion Info / Options */
                <div className="pt-1 max-w-xl">
                  <div className="flex flex-wrap items-center gap-3 p-3 rounded-2xl bg-white/70 dark:bg-slate-900/80 border border-slate-300/80 dark:border-slate-700/80 shadow-sm text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-500 dark:text-slate-400">Convert from:</span>
                      <span className="px-2 py-0.5 rounded-lg font-bold uppercase bg-slate-200/70 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                        {selectedFile?.name?.split('.').pop()?.toLowerCase() || options.convertFrom || 'Document'}
                      </span>
                    </div>
                    <div className="text-slate-400 font-bold">→</div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-500 dark:text-slate-400">Target format:</span>
                      <span className="px-2 py-0.5 rounded-lg font-bold uppercase bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                        {options.format}
                      </span>
                    </div>
                    {DOCUMENT_FORMATS[options.format]?.description && (
                      <span className="w-full text-[11px] text-slate-500 dark:text-slate-400 italic">
                        {DOCUMENT_FORMATS[options.format]?.name} ({DOCUMENT_FORMATS[options.format]?.description})
                      </span>
                    )}
                  </div>
                </div>
              )}
          </div>

          {/* ======================================================== */}
          {/* STEP 3: Convert Action & Progress UI                     */}
          {/* ======================================================== */}
          <div>
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
                    {conversion.phase === 'uploading' ? 'Step 1 of 2: Uploading' : 'Step 2 of 2: Converting'}
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
                      href={`/api/v1/converter/download?url=${encodeURIComponent(conversion.result.downloadUrl)}&filename=${encodeURIComponent(conversion.result.browserFilename)}&uid=${encodeURIComponent(conversion.result.uid || sessionUid || '')}&mediaType=${options.mediaType}`}
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
                    Convert another file
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Google Drive Video / Audio / Document File Picker Modal */}
      <DriveVideoPickerModal
        isOpen={isDrivePickerOpen}
        onClose={() => setIsDrivePickerOpen(false)}
        onSelect={(file) => {
          selectFile(file);
        }}
      />
    </div>
  );
}
