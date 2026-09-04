import { apiRequest } from '../api/client';
import {
  ConversionOptions,
  ConversionResult,
  VIDEO_FORMATS,
  AUDIO_FORMATS,
  MediaType,
  VIDEO_RESOLUTIONS,
  THREEGP_RESOLUTIONS,
} from './types';

export interface ConverterConfig {
  sEncoder: string;
  siteId: string;
  uid?: string;
  nodes?: string[];
}

export async function fetchConverterConfig(mediaType?: MediaType): Promise<ConverterConfig> {
  const query = mediaType ? `?mediaType=${encodeURIComponent(mediaType)}` : '';
  return apiRequest<ConverterConfig>(`/api/v1/converter/config${query}`);
}

export interface UploadProgressInfo {
  progressPercent: number;
  speedMb: number;
  etaSec: number;
}

export interface UploadResult {
  tmpFilename: string;
  durationInSeconds: number;
  raw: any;
}

export interface StreamTicketResponse {
  ticket: string;
  streamUrl: string;
  expiresAt: number;
}

/**
 * Creates a time-limited HMAC-signed streaming URL from the worker
 * allowing the remote 123Apps encoder to fetch the Google Drive video directly.
 */
export async function createStreamTicket(
  fileId: string,
  filename: string
): Promise<StreamTicketResponse> {
  return apiRequest<StreamTicketResponse>('/api/v1/converter/stream-ticket', {
    method: 'POST',
    body: JSON.stringify({ fileId, filename }),
  });
}

export interface RemoteImportTask {
  promise: Promise<UploadResult>;
  cancel: () => void;
}

/**
 * Commands the 123Apps remote encoder to fetch the video directly from the signed stream URL.
 * Video data streams server-to-server with ZERO browser upload/download bandwidth.
 */
export function importRemoteVideoToEncoder(
  sEncoder: string,
  streamUrl: string,
  filename: string,
  options?: {
    uid?: string;
    signal?: AbortSignal;
    onProgress?: (progressPercent: number) => void;
    mediaType?: MediaType;
  }
): RemoteImportTask {
  const isLocalDev =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.endsWith('.local'));

  const wsProtocol =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const uidParam = options?.uid ? `&uid=${encodeURIComponent(options.uid)}` : '';
  const proxyWsUrl =
    typeof window !== 'undefined' && window.location.host
      ? `${wsProtocol}//${window.location.host}/api/v1/converter/ws?encoder=${encodeURIComponent(sEncoder)}${uidParam}`
      : `wss://${sEncoder}/socket.io/?EIO=4&transport=websocket`;
  const directWsUrl = `wss://${sEncoder}/socket.io/?EIO=4&transport=websocket`;
  const initialWsUrl = isLocalDev ? directWsUrl : proxyWsUrl;

  let ws: WebSocket | null = null;
  let isCancelled = false;
  let triedFallback = isLocalDev;
  const operationId = `${Date.now()}_${sEncoder.replace(/[^a-zA-Z0-9]/g, '')}_${Math.random().toString(36).substring(2, 8)}`;
  let pid: number | null = null;
  const isAudio = options?.mediaType === 'audio';
  const isDocument = options?.mediaType === 'document';
  const siteId = isAudio ? 'aconv' : isDocument ? 'convert' : 'vconv';
  const codebaseId = siteId;

  let cancelFn: () => void = () => {};

  const promise = new Promise<UploadResult>((resolve, reject) => {
    const cleanUp = () => {
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
    };

    cancelFn = () => {
      isCancelled = true;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(
            `42["cancel_operation",{"site_id":"${siteId}","codebase_id":"${codebaseId}","operation_id":"${operationId}","pid":${pid || 'null'}}]`
          );
        } catch {
          // ignore
        }
      }
      cleanUp();
      reject(new Error('Remote import cancelled'));
    };

    if (options?.signal) {
      if (options.signal.aborted) {
        cancelFn();
        return;
      }
      options.signal.addEventListener('abort', () => {
        cancelFn();
      });
    }

    function bindSocket(socket: WebSocket) {
      ws = socket;

      socket.onopen = () => {
        // Connected
      };

      socket.onerror = () => {
        if (!isCancelled && !triedFallback && socket.readyState !== WebSocket.OPEN) {
          triedFallback = true;
          try {
            socket.close();
          } catch {
            // ignore
          }
          try {
            const directSocket = new WebSocket(directWsUrl);
            bindSocket(directSocket);
            return;
          } catch {
            // ignore
          }
        }
        if (!isCancelled) {
          reject(new Error('Remote encoder WebSocket connection failed'));
          cleanUp();
        }
      };

      socket.onclose = () => {
        // Closed
      };

      socket.onmessage = (event) => {
        if (isCancelled) return;
        const msg = String(event.data);

        // Engine.IO ping/pong
        if (msg === '2') {
          socket.send('3'); // pong
          return;
        }

        // Engine.IO handshake received ("0{...}")
        if (msg.startsWith('0')) {
          socket.send('40');
          return;
        }

        // Socket.IO connected ("40{...}")
        if (msg.startsWith('40')) {
          const payload = {
            site_id: siteId,
            codebase_id: codebaseId,
            uid: options?.uid,
            operation_id: operationId,
            action_type: 'open_remote',
            remote_url: streamUrl,
            original_filename: filename,
            secondary: false,
            id3: 1,
            ff: 1,
          };
          socket.send(`42["open_remote",${JSON.stringify(payload)}]`);
          return;
        }

        // Socket.IO custom event ("42["open_remote", ...]")
        if (msg.startsWith('42')) {
          try {
            const json = JSON.parse(msg.substring(2));
            const eventName = json[0];
            const data = json[1];

            if (eventName === 'open_remote' && data) {
              if (data.pid) pid = data.pid;

              const type = data.message_type;
              if (type === 'progress') {
                const val = parseInt(data.progress_value, 10);
                if (!isNaN(val)) {
                  options?.onProgress?.(val);
                }
              } else if (type === 'final_result') {
                const durationInSeconds = data.ff?.duration_in_seconds || 0;
                resolve({
                  tmpFilename: data.tmp_filename,
                  durationInSeconds,
                  raw: data,
                });
                cleanUp();
              } else if (type === 'error') {
                const rawDesc = data.error_desc || '';
                const friendlyDesc =
                  rawDesc.includes('bad_url') && (rawDesc.includes('localhost') || rawDesc.includes('127.0.0.1'))
                    ? 'Remote encoder cannot reach local development address (localhost). Transfer fallback required.'
                    : rawDesc || 'Remote download failed on encoder';
                reject(new Error(friendlyDesc));
                cleanUp();
              } else if (type === 'http_auth_request') {
                reject(new Error('Stream URL requires authentication'));
                cleanUp();
              } else if (type && type.includes('exceeded')) {
                reject(new Error('Video file size exceeds remote encoder quota'));
                cleanUp();
              }
            }
          } catch {
            // ignore JSON parse error
          }
        }
      };
    }

    try {
      bindSocket(new WebSocket(initialWsUrl));
    } catch {
      try {
        bindSocket(new WebSocket(directWsUrl));
      } catch (err) {
        reject(err);
      }
    }
  });

  return {
    promise,
    cancel: cancelFn,
  };
}

/**
 * Streams a video file from Google Drive via /api/v1/drive/files/:id/download (Range requests)
 * and relays each chunk through the worker flow proxy to the 123Apps video encoder.
 */
export async function uploadDriveVideoToEncoder(
  fileId: string,
  filename: string,
  fileSize: number,
  sEncoder: string,
  options?: {
    chunkSize?: number;
    signal?: AbortSignal;
    onProgress?: (info: UploadProgressInfo) => void;
    uid?: string;
    mediaType?: MediaType;
  }
): Promise<UploadResult> {
  const chunkSize = options?.chunkSize || 10 * 1024 * 1024; // 10MB chunks
  const totalChunks = Math.max(1, Math.ceil(fileSize / chunkSize));
  const identifier = `${fileSize}-${filename.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const uid = options?.uid || ('u' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36));

  let uploadedBytes = 0;
  const startTime = Date.now();
  let lastResultJson: any = null;

  for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
    if (options?.signal?.aborted) {
      throw new Error('Upload cancelled');
    }

    const start = chunkIdx * chunkSize;
    const end = Math.min(start + chunkSize - 1, fileSize - 1);
    const expectedLength = end - start + 1;

    // 1. Fetch chunk from Google Drive via backend with Range
    const driveRes = await fetch(`/api/v1/drive/files/${encodeURIComponent(fileId)}/download`, {
      headers: {
        Range: `bytes=${start}-${end}`,
      },
      signal: options?.signal,
    });

    if (!driveRes.ok && driveRes.status !== 206) {
      throw new Error(`Failed to read file chunk from Google Drive (status ${driveRes.status})`);
    }

    const chunkArrayBuffer = await driveRes.arrayBuffer();

    if (options?.signal?.aborted) {
      throw new Error('Upload cancelled');
    }

    // 2. Build multipart form data for Flow.js upload
    const formData = new FormData();
    formData.append('flowChunkNumber', String(chunkIdx + 1));
    formData.append('flowChunkSize', String(chunkSize));
    formData.append('flowCurrentChunkSize', String(chunkArrayBuffer.byteLength));
    formData.append('flowTotalSize', String(fileSize));
    formData.append('flowIdentifier', identifier);
    formData.append('flowFilename', filename);
    formData.append('flowRelativePath', filename);
    formData.append('flowTotalChunks', String(totalChunks));
    formData.append(
      'file',
      new Blob([chunkArrayBuffer], { type: 'application/octet-stream' }),
      filename
    );

    // 3. Post to worker relay
    const siteId =
      options?.mediaType === 'audio'
        ? 'aconv'
        : options?.mediaType === 'document'
        ? 'convert'
        : 'vconv';
    const flowQuery = new URLSearchParams({
      encoder: sEncoder,
      site_id: siteId,
      uid,
      id3: '1',
      ff: '1',
    }).toString();

    const flowRes = await fetch(`/api/v1/converter/flow?${flowQuery}`, {
      method: 'POST',
      body: formData,
      signal: options?.signal,
    });

    if (!flowRes.ok) {
      const errText = await flowRes.text().catch(() => '');
      throw new Error(`Encoder upload failed (${flowRes.status}): ${errText || 'Proxy error'}`);
    }

    const responseText = await flowRes.text();
    try {
      lastResultJson = JSON.parse(responseText);
    } catch {
      // not final or non-json
    }

    uploadedBytes += chunkArrayBuffer.byteLength;
    const elapsedSec = (Date.now() - startTime) / 1000;
    const speedBytesPerSec = elapsedSec > 0 ? uploadedBytes / elapsedSec : 0;
    const speedMb = parseFloat((speedBytesPerSec / (1024 * 1024)).toFixed(1));
    const remainingBytes = Math.max(0, fileSize - uploadedBytes);
    const etaSec = speedBytesPerSec > 0 ? Math.round(remainingBytes / speedBytesPerSec) : 0;
    const progressPercent = Math.min(99, Math.round((uploadedBytes / fileSize) * 100));

    if (options?.onProgress) {
      options.onProgress({
        progressPercent,
        speedMb,
        etaSec,
      });
    }
  }

  if (!lastResultJson || !lastResultJson.tmp_filename) {
    throw new Error('Encoder did not return a temporary filename after upload');
  }

  const durationInSeconds = lastResultJson.ff?.duration_in_seconds || 0;

  return {
    tmpFilename: lastResultJson.tmp_filename,
    durationInSeconds,
    raw: lastResultJson,
  };
}

/**
 * Socket.IO v4 client over WebSocket to drive the ffmpeg encoding job on the 123apps encoder.
 */
export function startEncodingJob(
  sEncoder: string,
  tmpFilename: string,
  durationInSeconds: number,
  options: ConversionOptions & { uid?: string },
  callbacks: {
    onStart?: () => void;
    onProgress?: (percent: number) => void;
    onComplete?: (result: ConversionResult) => void;
    onError?: (error: string) => void;
  }
): { cancel: () => void } {
  if (options.mediaType === 'document') {
    let isCancelled = false;
    const abortController = new AbortController();
    const operationId = `${Date.now()}_${sEncoder.replace(/[^a-zA-Z0-9]/g, '')}_${Math.random().toString(36).substring(2, 8)}`;

    callbacks.onStart?.();
    callbacks.onProgress?.(30);

    const progressInterval = setInterval(() => {
      if (!isCancelled) {
        callbacks.onProgress?.(70);
      }
    }, 1000);

    (async () => {
      try {
        const res = await apiRequest<any>('/api/v1/converter/process', {
          method: 'POST',
          body: JSON.stringify({
            encoder: sEncoder,
            siteId: 'convert',
            uid: options.uid,
            operationId,
            convertFrom: options.convertFrom || 'pdf',
            convertTo: options.format,
            tmpFilename,
          }),
          signal: abortController.signal,
        });

        clearInterval(progressInterval);

        if (isCancelled) return;

        if (res.error || !res.download_url) {
          callbacks.onError?.(res.error_title || 'Document conversion failed');
          return;
        }

        callbacks.onProgress?.(100);
        let downloadUrl = res.download_url;
        if (downloadUrl.startsWith('//')) {
          downloadUrl = 'https:' + downloadUrl;
        }

        const baseName = options.originalFilename
          ? options.originalFilename.replace(/\.[^/.]+$/, '')
          : 'converted';
        const browserFilename = `${baseName}.${options.format}`;

        callbacks.onComplete?.({
          downloadUrl,
          browserFilename,
          filesize: res.output_filesize,
          uid: options.uid,
        });
      } catch (err) {
        clearInterval(progressInterval);
        if (!isCancelled) {
          callbacks.onError?.((err as Error).message || 'Document conversion request failed');
        }
      }
    })();

    return {
      cancel: () => {
        isCancelled = true;
        clearInterval(progressInterval);
        abortController.abort();
      },
    };
  }

  const isLocalDev =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.endsWith('.local'));

  const wsProtocol =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const uidParam = options.uid ? `&uid=${encodeURIComponent(options.uid)}` : '';
  const proxyWsUrl =
    typeof window !== 'undefined' && window.location.host
      ? `${wsProtocol}//${window.location.host}/api/v1/converter/ws?encoder=${encodeURIComponent(sEncoder)}${uidParam}`
      : `wss://${sEncoder}/socket.io/?EIO=4&transport=websocket`;
  const directWsUrl = `wss://${sEncoder}/socket.io/?EIO=4&transport=websocket`;

  // In local development, connect directly to avoid dev-server proxy overhead.
  // In production, use the worker stealth proxy to completely mask the application domain and IP.
  const initialWsUrl = isLocalDev ? directWsUrl : proxyWsUrl;

  let ws: WebSocket | null = null;
  let isCancelled = false;
  let triedFallback = isLocalDev;
  let operationId = `${Date.now()}_${sEncoder.replace(/[^a-zA-Z0-9]/g, '')}_${Math.random().toString(36).substring(2, 8)}`;
  let pid: number | null = null;

  const cleanUp = () => {
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore
      }
      ws = null;
    }
  };

  const cancel = () => {
    isCancelled = true;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        const siteId =
          options?.mediaType === 'audio'
            ? 'aconv'
            : options?.mediaType === 'document'
            ? 'convert'
            : 'vconv';
        ws.send(
          `42["cancel_operation",{"site_id":"${siteId}","codebase_id":"${siteId}","operation_id":"${operationId}","pid":${pid || 'null'}}]`
        );
      } catch {
        // ignore
      }
    }
    cleanUp();
  };

  function bindSocket(socket: WebSocket) {
    ws = socket;

    socket.onopen = () => {
      // Connected
    };

    socket.onerror = () => {
      if (!isCancelled && !triedFallback && socket.readyState !== WebSocket.OPEN) {
        triedFallback = true;
        try {
          socket.close();
        } catch {
          // ignore
        }
        try {
          const directSocket = new WebSocket(directWsUrl);
          bindSocket(directSocket);
          return;
        } catch {
          // ignore
        }
      }
      if (!isCancelled) {
        callbacks.onError?.('Encoder WebSocket error');
      }
    };

    socket.onclose = () => {
      // closed
    };

    socket.onmessage = (event) => {
      if (isCancelled) return;
      const msg = String(event.data);

      // Engine.IO ping/pong
      if (msg === '2') {
        socket.send('3'); // pong
        return;
      }

      // Engine.IO handshake received ("0{...}")
      if (msg.startsWith('0')) {
        // Send Socket.IO connect packet "40"
        socket.send('40');
        return;
      }

      // Socket.IO connected ("40{...}")
      if (msg.startsWith('40')) {
        // Emit "encode" packet "42["encode", { ... }]"
        const isAudio = options.mediaType === 'audio';
        const siteId = isAudio ? 'aconv' : 'vconv';
        const codebaseId = isAudio ? 'aconv' : 'vconv';

        let encodePayload: Record<string, any>;

        if (isAudio) {
          const AUDIO_PRESET_NUMERIC_MAP: Record<string, number> = {
            first: 0,
            economy: 0,
            second: 1,
            standard: 1,
            third: 2,
            good: 2,
            fourth: 3,
            best: 3,
          };
          const numericPreset =
            typeof options.preset === 'number'
              ? options.preset
              : (AUDIO_PRESET_NUMERIC_MAP[options.preset] ?? 1);

          encodePayload = {
            site_id: 'aconv',
            codebase_id: 'aconv',
            operation_id: operationId,
            action_type: 'encode',
            format_type: 'audio',
            format: options.format,
            preset: numericPreset,
            fastmode: Boolean(options.audioAdvanced?.fastMode),
            fadein: Boolean(options.audioAdvanced?.fadeIn),
            fadeout: Boolean(options.audioAdvanced?.fadeOut),
            remove_voice: false,
            reverse: Boolean(options.audioAdvanced?.reverse),
            preset_priority: false,
            bitrate_type: options.audioAdvanced?.bitrateType || 'constant',
            constant_bitrate: options.audioAdvanced?.constantBitrate ?? 128,
            variable_bitrate: options.audioAdvanced?.variableBitrate ?? 5,
            sample_rate: options.audioAdvanced?.sampleRate ?? 44100,
            channels: options.audioAdvanced?.channels ?? 2,
            tmp_filename: tmpFilename,
            duration_in_seconds: durationInSeconds,
            trackinfo: {
              set_tag: Boolean(options.trackInfo?.setTag),
              track_tag_title: options.trackInfo?.title || '',
              track_tag_artist: options.trackInfo?.artist || '',
              track_tag_album: options.trackInfo?.album || '',
              track_tag_year: options.trackInfo?.year || '',
              track_tag_genre: options.trackInfo?.genre || '',
              track_tag_comment: options.trackInfo?.comment || '',
            },
          };
        } else {
          const formatConfig = VIDEO_FORMATS[options.format];
          const targetFormat = formatConfig?.ffmpegFormat || options.format;

          encodePayload = {
            site_id: siteId,
            codebase_id: codebaseId,
            operation_id: operationId,
            action_type: 'encode',
            tmp_filename: tmpFilename,
            duration_in_seconds: durationInSeconds,
            format_type: options.mediaType,
            format: targetFormat,
            preset: options.preset,
            preset_priority: true,
            no_audio: options.noAudio,
          };

          if (options.vcodec) encodePayload.vcodec = options.vcodec;
          if (options.acodec && !options.noAudio) encodePayload.acodec = options.acodec;

          // Always supply audio bitrate and channels if audio is present
          const audioBitrate = options.noAudio ? 0 : (options.ab || 128);
          if (!options.noAudio) {
            encodePayload.ab = audioBitrate;
            encodePayload.ac = audioBitrate <= 80 ? 1 : 2;
            encodePayload.ar = 44100;
          }

          // Video bitrate (vb): Always compute and supply vb, matching video-converter.com (vconv.js)
          let videoBitrate = 0;
          if (options.targetFilesizeMb && options.targetFilesizeMb > 0) {
            const duration = durationInSeconds > 0 ? durationInSeconds : 60;
            const totalBits = options.targetFilesizeMb * 1024 * 1024 * 8;
            const audioBits = audioBitrate * 1024 * duration;
            videoBitrate = Math.max(10, Math.round((totalBits - audioBits) / duration / 1024));
          } else if (options.vb && options.vb > 0) {
            videoBitrate = options.vb;
          } else {
            const presetObj =
              options.format === '3gp'
                ? THREEGP_RESOLUTIONS.find((r) => r.id === options.preset)
                : VIDEO_RESOLUTIONS.find((r) => r.id === options.preset);
            videoBitrate = presetObj?.vb || 4500;
          }

          if (videoBitrate > 0) {
            encodePayload.vb = videoBitrate;
          }

          // IMPORTANT: preset_priority is ALWAYS true on video-converter.com (vconv.js: t.preset_priority = !0)
          // Setting it to false causes 123apps FFmpeg server to bypass the preset (downscaling) and codec overrides.
          encodePayload.preset_priority = true;
        }

        socket.send(`42["encode",${JSON.stringify(encodePayload)}]`);
        return;
      }

      // Socket.IO custom event ("42["event", ...]")
      if (msg.startsWith('42')) {
        try {
          const json = JSON.parse(msg.substring(2));
          const eventName = json[0];
          const data = json[1];

          if (eventName === 'encode' && data) {
            if (data.pid) pid = data.pid;

            const type = data.message_type;
            if (type === 'handshake') {
              callbacks.onStart?.();
            } else if (type === 'progress') {
              const val = parseInt(data.progress_value, 10);
              if (!isNaN(val)) callbacks.onProgress?.(val);
            } else if (type === 'final_result') {
              let downloadUrl = data.download_url || '';
              if (downloadUrl.startsWith('//')) {
                downloadUrl = 'https:' + downloadUrl;
              }
              // Normalize hostnames lacking DNS (e.g. s*.online-audio-converter.com -> s*.video-converter.com)
              downloadUrl = downloadUrl.replace(/([a-zA-Z0-9_-]+)\.online-audio-converter\.com/g, '$1.video-converter.com');
              callbacks.onComplete?.({
                downloadUrl,
                browserFilename: data.browser_filename || `converted_${data.public_filename || options.format}`,
                publicFilename: data.public_filename,
                uid: options?.uid,
              });
              cleanUp();
            } else if (type === 'error') {
              const rawDesc = data.error_desc || '';
              const friendlyDesc =
                rawDesc.toLowerCase() === 'process error'
                  ? 'Transcoding failed. The file format, resolution, or codec may be incompatible.'
                  : rawDesc || 'Encoding failed on remote server';
              callbacks.onError?.(friendlyDesc);
              cleanUp();
            } else if (type && type.includes('exceeded')) {
              callbacks.onError?.('Conversion quota or file size exceeded limit');
              cleanUp();
            }
          }
        } catch {
          // ignore parse error
        }
      }
    };
  }

  try {
    bindSocket(new WebSocket(initialWsUrl));
  } catch {
    try {
      bindSocket(new WebSocket(directWsUrl));
    } catch (err) {
      callbacks.onError?.((err as Error).message || 'Failed to connect to encoder WebSocket');
      return { cancel: () => {} };
    }
  }

  return { cancel };
}
