import { unpackArchive } from '../api/drive';

export interface ExtractMeTreeNode {
  id?: string;
  text: string;
  children?: ExtractMeTreeNode[];
  icon?: string;
  data?: {
    size?: number;
    isDir?: boolean;
    path?: string;
    [key: string]: any;
  };
  state?: {
    opened?: boolean;
    selected?: boolean;
    disabled?: boolean;
  };
}

export interface ExtractedFileItem {
  id: string;
  name: string;
  path: string[];
  fullPath: string;
  isFolder: boolean;
  size?: number;
  node: ExtractMeTreeNode;
}

export interface ExtractRemoteTask {
  promise: Promise<{ tmp_filename: string; archive_filename: string }>;
  cancel: () => void;
}

export const DEFAULT_EXTRACT_ME_HOST = 's88.extract.me';
export const KNOWN_EXTRACT_ME_HOSTS = ['s88.extract.me', 's85.extract.me'];

export class ExtractMeClient {
  public host: string;
  public uid: string;

  constructor(host: string = DEFAULT_EXTRACT_ME_HOST, uid?: string) {
    this.host = host.replace(/extract\.io/g, 'extract.me');
    this.uid = uid || this.generateUid();
  }

  private generateUid(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let res = '';
    for (let i = 0; i < 16; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return res;
  }

  /**
   * Instructs extract.me to download the Google Drive archive directly
   * using the user's fresh Google OAuth access token.
   */
  openFromDrive(params: {
    fileId: string;
    accessToken: string;
    fileName: string;
    fileSize: number;
    onProgress?: (progressPercent: number) => void;
    signal?: AbortSignal;
  }): ExtractRemoteTask {
    const isLocalDev =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.endsWith('.local'));

    const abortController = new AbortController();
    if (params.signal) {
      params.signal.addEventListener('abort', () => abortController.abort());
    }

    if (isLocalDev) {
      const promise = this.uploadArchiveInChunks({
        fileId: params.fileId,
        fileName: params.fileName,
        fileSize: params.fileSize,
        onProgress: params.onProgress,
        signal: abortController.signal,
      });

      return {
        promise,
        cancel: () => abortController.abort(),
      };
    }

    const clientUid = this.uid;
    const clientHost = this.host;

    const wsProtocol =
      typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const uidParam = clientUid ? `&uid=${encodeURIComponent(clientUid)}` : '';
    const proxyWsUrl =
      typeof window !== 'undefined' && window.location.host
        ? `${wsProtocol}//${window.location.host}/api/v1/converter/ws?encoder=${encodeURIComponent(clientHost)}${uidParam}`
        : `wss://${clientHost}/socket.io/?EIO=4&transport=websocket`;
    const directWsUrl = `wss://${clientHost}/socket.io/?EIO=4&transport=websocket`;
    const initialWsUrl = proxyWsUrl;

    let ws: WebSocket | null = null;
    let isCancelled = false;
    let triedFallback = false;
    const operationId = `${Date.now()}_${clientHost.replace(/[^a-zA-Z0-9]/g, '')}_${Math.random().toString(36).substring(2, 8)}`;
    let pid: number | null = null;
    const siteId = 'unarchiver';
    const codebaseId = 'unarchiver';

    let cancelFn: () => void = () => {};

    const promise = new Promise<{ tmp_filename: string; archive_filename: string }>((resolve, reject) => {
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
        abortController.abort();
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
        reject(new Error('Extraction cancelled'));
      };

      if (abortController.signal.aborted) {
        cancelFn();
        return;
      }
      abortController.signal.addEventListener('abort', () => {
        cancelFn();
      });

      const bindSocket = (socket: WebSocket) => {
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
            // Fallback to chunk upload if WebSocket connection fails
            this.uploadArchiveInChunks({
              fileId: params.fileId,
              fileName: params.fileName,
              fileSize: params.fileSize,
              onProgress: params.onProgress,
              signal: abortController.signal,
            })
              .then(resolve)
              .catch(reject);
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
            socket.send('3');
            return;
          }

          // Engine.IO handshake
          if (msg.startsWith('0')) {
            socket.send('40');
            return;
          }

          // Socket.IO connected
          if (msg.startsWith('40')) {
            const ext = params.fileName.split('.').pop() || '';
            const payload = {
              site_id: siteId,
              codebase_id: codebaseId,
              uid: clientUid,
              operation_id: operationId,
              action_type: 'open_remote',
              remote_url: `gdrive://${params.fileId}`,
              original_filename: params.fileName,
              params: {
                google_access_token: params.accessToken,
                original_filename: params.fileName,
                file_extension: ext,
                filesize: params.fileSize,
                gdrive_file_id: params.fileId,
                secondary: false,
              },
              secondary: false,
              id3: 1,
              ff: 1,
            };
            socket.send(`42["open_remote",${JSON.stringify(payload)}]`);
            return;
          }

          // Socket.IO custom event
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
                    params.onProgress?.(val);
                  }
                } else if (type === 'final_result') {
                  resolve({
                    tmp_filename: data.tmp_filename,
                    archive_filename: data.original_filename || params.fileName,
                  });
                  cleanUp();
                } else if (type === 'error') {
                  // Remote gdrive open failed on extract.me (e.g. token mismatch), fallback to chunked upload
                  this.uploadArchiveInChunks({
                    fileId: params.fileId,
                    fileName: params.fileName,
                    fileSize: params.fileSize,
                    onProgress: params.onProgress,
                    signal: abortController.signal,
                  })
                    .then(resolve)
                    .catch((chunkErr) => {
                      reject(chunkErr);
                    });
                  cleanUp();
                } else if (type === 'http_auth_request') {
                  reject(new Error('Archive requires password or authorization'));
                  cleanUp();
                }
              }
            } catch {
              // Non-fatal parse error
            }
          }
        };
      };

      try {
        const socket = new WebSocket(initialWsUrl);
        bindSocket(socket);
      } catch (err) {
        // Fallback to chunked upload
        this.uploadArchiveInChunks({
          fileId: params.fileId,
          fileName: params.fileName,
          fileSize: params.fileSize,
          onProgress: params.onProgress,
          signal: abortController.signal,
        })
          .then(resolve)
          .catch(reject);
      }
    });

    return {
      promise,
      cancel: () => cancelFn(),
    };
  }

  /**
   * Uploads an archive file from Google Drive to extract.me using chunked Flow.js
   * relay through the worker backend.
   */
  async uploadArchiveInChunks(params: {
    fileId: string;
    fileName: string;
    fileSize: number;
    onProgress?: (progressPercent: number) => void;
    signal?: AbortSignal;
  }): Promise<{ tmp_filename: string; archive_filename: string }> {
    const { fileId, fileName, signal, onProgress } = params;
    let actualSize = params.fileSize;

    if (!actualSize || actualSize <= 0) {
      try {
        const headRes = await fetch(`/api/v1/drive/files/${encodeURIComponent(fileId)}/download`, {
          method: 'HEAD',
          signal,
        });
        const cl = headRes.headers.get('content-length');
        if (cl) {
          actualSize = parseInt(cl, 10);
        }
      } catch {
        // ignore
      }
    }
    if (!actualSize || actualSize <= 0) {
      actualSize = 1;
    }

    const chunkSize = 2 * 1024 * 1024; // 2MB chunks for smooth progress and low latency
    const totalChunks = Math.max(1, Math.ceil(actualSize / chunkSize));
    const identifier = `${actualSize}-${fileName.replace(/[^0-9a-zA-Z_-]/g, '')}`;

    let uploadedBytes = 0;
    let lastResultJson: any = null;

    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
      if (signal?.aborted) {
        throw new Error('Upload cancelled');
      }

      const start = chunkIdx * chunkSize;
      const end = Math.min(start + chunkSize - 1, actualSize - 1);

      // 1. Fetch chunk from Google Drive via backend with Range
      const driveRes = await fetch(`/api/v1/drive/files/${encodeURIComponent(fileId)}/download`, {
        headers: {
          Range: `bytes=${start}-${end}`,
        },
        signal,
      });

      if (!driveRes.ok && driveRes.status !== 206) {
        throw new Error(`Failed to read file chunk from Google Drive (status ${driveRes.status})`);
      }

      const chunkArrayBuffer = await driveRes.arrayBuffer();

      if (signal?.aborted) {
        throw new Error('Upload cancelled');
      }

      // 2. Build multipart form data for Flow.js upload
      const formData = new FormData();
      formData.append('flowChunkNumber', String(chunkIdx + 1));
      formData.append('flowChunkSize', String(chunkSize));
      formData.append('flowCurrentChunkSize', String(chunkArrayBuffer.byteLength));
      formData.append('flowTotalSize', String(actualSize));
      formData.append('flowIdentifier', identifier);
      formData.append('flowFilename', fileName);
      formData.append('flowRelativePath', fileName);
      formData.append('flowTotalChunks', String(totalChunks));
      formData.append(
        'file',
        new Blob([chunkArrayBuffer], { type: 'application/octet-stream' }),
        fileName
      );

      // 3. Post to worker relay with unarchiver parameters
      let flowRes: Response | null = null;
      let lastErr: Error | null = null;
      const hostCandidates = [this.host, ...KNOWN_EXTRACT_ME_HOSTS.filter((h) => h !== this.host)];

      for (let hIdx = 0; hIdx < hostCandidates.length; hIdx++) {
        const candidate = hostCandidates[hIdx];
        const flowQuery = new URLSearchParams({
          encoder: candidate,
          site_id: 'unarchiver',
          uid: this.uid,
          ud: '1',
        }).toString();

        try {
          const res = await fetch(`/api/v1/converter/flow?${flowQuery}`, {
            method: 'POST',
            body: formData,
            signal,
          });

          if (res.ok) {
            flowRes = res;
            this.host = candidate;
            break;
          }

          // If not chunk 0, cannot switch host mid-upload
          if (chunkIdx > 0) {
            flowRes = res;
            break;
          }
          lastErr = new Error(`Extraction server (${candidate}) upload failed (${res.status})`);
        } catch (fetchErr) {
          lastErr = fetchErr as Error;
          if (chunkIdx > 0) {
            throw fetchErr;
          }
        }
      }

      if (!flowRes || !flowRes.ok) {
        const errText = flowRes ? await flowRes.text().catch(() => '') : '';
        throw new Error(
          lastErr?.message ||
            `Extraction server upload failed (${flowRes?.status || 500}): ${errText || 'Proxy error'}`
        );
      }

      const responseText = await flowRes.text();
      try {
        lastResultJson = JSON.parse(responseText);
      } catch {
        // not final or non-json
      }

      uploadedBytes += chunkArrayBuffer.byteLength;
      const progressPercent = Math.min(99, Math.round((uploadedBytes / actualSize) * 100));
      onProgress?.(progressPercent);
    }

    if (!lastResultJson || !lastResultJson.tmp_filename) {
      throw new Error('Extraction server did not return temporary filename after upload');
    }

    return {
      tmp_filename: lastResultJson.tmp_filename,
      archive_filename: fileName,
    };
  }

  /**
   * Unpacks the archive and returns the file tree structure.
   */
  async unpack(params: {
    tmp_filename: string;
    archive_filename?: string;
    password?: string;
  }): Promise<{
    tree_data: ExtractMeTreeNode[];
    tmp_filename: string;
    archive_filename: string;
    error?: string;
    error_type?: string;
    message_type?: string;
  }> {
    const res = await unpackArchive({
      host: this.host,
      tmp_filename: params.tmp_filename,
      archive_filename: params.archive_filename,
      password: params.password,
    });

    if (res.error) {
      return {
        tree_data: [],
        tmp_filename: params.tmp_filename,
        archive_filename: params.archive_filename || 'archive',
        error: res.error,
        error_type: res.error_type,
        message_type: res.message_type,
      };
    }

    const tree: ExtractMeTreeNode[] = Array.isArray(res.tree)
      ? res.tree
      : Array.isArray(res.tree_data)
      ? res.tree_data
      : [];

    return {
      tree_data: tree,
      tmp_filename: params.tmp_filename,
      archive_filename: params.archive_filename || 'archive',
    };
  }

  /**
   * Generates a download URL for a single file inside the extracted archive.
   */
  getFileDownloadUrl(
    tmp_filename: string,
    pathParts: string[],
    fileName?: string
  ): { directUrl: string; proxiedUrl: string } {
    const rawPath = pathParts.join('/');
    const pathStr = encodeURIComponent(rawPath);
    const directUrl = `https://${this.host}/unarchiver/download_d/${this.uid || 'nouid'}/${tmp_filename}/${pathStr}`;
    const targetFilename = fileName || pathParts[pathParts.length - 1] || 'file';
    const proxiedUrl = `/api/v1/converter/download?url=${encodeURIComponent(directUrl)}&filename=${encodeURIComponent(targetFilename)}&uid=${encodeURIComponent(this.uid)}`;

    return { directUrl, proxiedUrl };
  }

  /**
   * Requests extraction engine to compress all extracted files into a ZIP bundle,
   * resolves the actual download URL from the JSON response, and returns the proxied URL.
   */
  async requestZipDownload(
    tmp_filename: string,
    archiveName: string
  ): Promise<{ directUrl: string; proxiedUrl: string }> {
    const compressEndpoint = `https://${this.host}/unarchiver/compress/zip/${this.uid ? `${this.uid}/` : 'nouid/'}${tmp_filename}`;
    const zipName = archiveName.endsWith('.zip') ? archiveName : `${archiveName}.zip`;

    // Trigger compress endpoint via worker proxy to send valid Origin/Referer headers
    const triggerUrl = `/api/v1/converter/download?url=${encodeURIComponent(compressEndpoint)}&filename=trigger.json&uid=${encodeURIComponent(this.uid)}`;
    const triggerRes = await fetch(triggerUrl);

    if (!triggerRes.ok) {
      throw new Error(`Failed to generate ZIP archive: HTTP ${triggerRes.status}`);
    }

    const triggerText = await triggerRes.text();
    let downloadPath = '';
    try {
      const data = JSON.parse(triggerText);
      downloadPath = data.download_url || '';
    } catch {
      throw new Error('Invalid response from extraction engine when generating ZIP');
    }

    if (!downloadPath) {
      throw new Error('Extraction engine did not return a ZIP download link');
    }

    const cleanPath = downloadPath.startsWith('/') ? downloadPath : `/${downloadPath}`;
    const fullPath = cleanPath.startsWith('/unarchiver') ? cleanPath : `/unarchiver${cleanPath}`;
    const directUrl = `https://${this.host}${fullPath}`;
    const proxiedUrl = `/api/v1/converter/download?url=${encodeURIComponent(directUrl)}&filename=${encodeURIComponent(zipName)}&uid=${encodeURIComponent(this.uid)}`;

    return { directUrl, proxiedUrl };
  }

  /**
   * Flattens a jstree recursive structure into a list of file items with full paths.
   */
  flattenTree(nodes: ExtractMeTreeNode[], parentPath: string[] = []): ExtractedFileItem[] {
    const items: ExtractedFileItem[] = [];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const name = node.text || 'Unnamed';
      const currentPath = [...parentPath, name];
      const fullPath = currentPath.join('/');
      const isFolder = Boolean(node.children && Array.isArray(node.children) && node.children.length > 0);

      items.push({
        id: node.id || `node_${fullPath}_${i}`,
        name,
        path: currentPath,
        fullPath,
        isFolder,
        size: node.data?.size,
        node,
      });

      if (node.children && Array.isArray(node.children)) {
        items.push(...this.flattenTree(node.children, currentPath));
      }
    }

    return items;
  }
}
