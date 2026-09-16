import { unpackArchive, ingestArchiveChunk } from '../api/drive';

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
   * Ingests a Google Drive archive into extract.me so its contents can be listed
   * and individual files saved to Drive.
   *
   * IMPORTANT: this always uses the Flow.js chunked-upload path. extract.me only
   * serves individual extracted files (download_t / download_d) for archives that
   * were ingested via chunked upload. Archives opened server-side via the
   * `open_remote` WebSocket action unpack correctly, but their entries are never
   * materialized to the per-file download location — download_d returns 404 for
   * every file — so "Save to Google Drive" fails for all of them.
   *
   * The chunked upload itself runs entirely server-side: the browser sends only
   * small per-chunk control messages, and the worker reads each chunk from Drive
   * and relays it to extract.me (Drive -> worker -> extract.me). The archive bytes
   * never pass through the user's connection, so extraction costs no user bandwidth.
   *
   * `accessToken` and `streamUrl` are retained on the params for call-site
   * compatibility; they were only needed by the retired `open_remote` path.
   */
  openFromDrive(params: {
    fileId: string;
    accessToken: string;
    fileName: string;
    fileSize: number;
    streamUrl?: string;
    onProgress?: (progressPercent: number) => void;
    signal?: AbortSignal;
  }): ExtractRemoteTask {
    const abortController = new AbortController();
    if (params.signal) {
      if (params.signal.aborted) {
        abortController.abort();
      } else {
        params.signal.addEventListener('abort', () => abortController.abort());
      }
    }

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

  /**
   * Drives the server-side chunked ingest of an archive from Google Drive into
   * extract.me. Each iteration sends one small control message to the worker, which
   * reads that chunk's bytes from Drive and relays them to extract.me's Flow.js
   * endpoint. No archive bytes travel through the browser.
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

    // Larger chunks than the old browser relay (8MB vs 2MB): each chunk is now a single
    // worker round-trip that reads from Drive and posts to extract.me, so fewer, bigger
    // chunks mean fewer round-trips while staying well under the Worker memory limit.
    const chunkSize = 8 * 1024 * 1024;
    const totalChunks = Math.max(1, Math.ceil(actualSize / chunkSize));
    const identifier = `${actualSize}-${fileName.replace(/[^0-9a-zA-Z_-]/g, '')}`;

    let tmpFilename: string | null = null;

    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
      if (signal?.aborted) {
        throw new Error('Upload cancelled');
      }

      const result = await ingestArchiveChunk(
        {
          fileId,
          fileName,
          fileSize: actualSize,
          chunkNumber: chunkIdx + 1,
          chunkSize,
          totalChunks,
          identifier,
          uid: this.uid,
          host: this.host,
        },
        signal
      );

      // The worker may have failed over to another node on the first chunk; pin to
      // whichever host accepted it so later chunks, unpack, and downloads all agree.
      if (result.host) {
        this.host = result.host;
      }
      if (result.tmpFilename) {
        tmpFilename = result.tmpFilename;
      }

      const progressPercent = Math.min(99, Math.round(((chunkIdx + 1) / totalChunks) * 100));
      onProgress?.(progressPercent);
    }

    if (!tmpFilename) {
      throw new Error('Extraction server did not return temporary filename after upload');
    }

    return {
      tmp_filename: tmpFilename,
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
      uid: this.uid,
    });

    if (res.error) {
      const errorMessage =
        typeof res.error === 'string'
          ? res.error
          : res.error_title ||
            res.error_desc ||
            res.message ||
            'Failed to extract archive contents';

      return {
        tree_data: [],
        tmp_filename: params.tmp_filename,
        archive_filename: params.archive_filename || 'archive',
        error: errorMessage,
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
      const isFolder = Boolean(
        node.data?.isDir ||
        (node as any).type === 'folder' ||
        (node as any).type === 'dir' ||
        node.icon === 'folder' ||
        (typeof node.icon === 'string' && node.icon.includes('folder')) ||
        Array.isArray(node.children)
      );

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
