import { z } from 'zod';
import { uploadJobStatuses, UploadJobStatus } from './jobState';

export const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB
export const MAX_CONCURRENT_JOBS_PER_USER = 25;
export const MAX_DAILY_JOBS_PER_USER = 100;
export const MAX_BATCH_URLS = 50;

/**
 * Accepted shape of an `Idempotency-Key` header.
 *
 * The key is not just a dedupe token: it becomes the job's primary key, a segment of the R2 staging
 * path, and the Workflow instance id. Restricting it to an opaque identifier keeps a caller from
 * steering any of those with `/`, `..`, `?` or whitespace. A UUID — what every client here sends —
 * fits comfortably.
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isValidIdempotencyKey(key: string | undefined | null): key is string {
  return typeof key === 'string' && IDEMPOTENCY_KEY_PATTERN.test(key);
}

// API Error Contract
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retriable: z.boolean(),
    requestId: z.string(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

// Account & Session Contracts
export const AccountViewSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  picture: z.string().url().nullable().optional(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  revokedAt: z.string().nullable().optional(),
});

export type AccountView = z.infer<typeof AccountViewSchema>;

export const SessionViewSchema = z.object({
  user: AccountViewSchema,
  expiresAt: z.string(),
});

export type SessionView = z.infer<typeof SessionViewSchema>;

// Preferences Contracts
export const ThemeModeSchema = z.enum(['light', 'dark', 'system']);
export type ThemeMode = z.infer<typeof ThemeModeSchema>;

export const PreferencesViewSchema = z.object({
  themeMode: ThemeModeSchema,
  colorScheme: z.string(),
  filenamePattern: z.string(),
  notificationsEnabled: z.boolean(),
  defaultFolderId: z.string().nullable().optional(),
  defaultFolderName: z.string().nullable().optional(),
  rememberAccount: z.boolean(),
  updatedAt: z.string(),
});

export type PreferencesView = z.infer<typeof PreferencesViewSchema>;

export const UpdatePreferencesSchema = z.object({
  themeMode: ThemeModeSchema.optional(),
  colorScheme: z.string().min(1).max(64).optional(),
  filenamePattern: z.string().min(1).max(255).optional(),
  notificationsEnabled: z.boolean().optional(),
  defaultFolderId: z.string().max(128).nullable().optional(),
  defaultFolderName: z.string().max(255).nullable().optional(),
  rememberAccount: z.boolean().optional(),
});

export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesSchema>;

// Upload Job Contracts
export const SourceKindSchema = z.enum(['local', 'remote']);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const UploadJobViewSchema = z.object({
  id: z.string(),
  userId: z.string(),
  batchId: z.string().nullable().optional(),
  sourceKind: SourceKindSchema,
  sourceUrlRedacted: z.string().nullable().optional(),
  filename: z.string(),
  fileSize: z.number().int().nonnegative(),
  mimeType: z.string(),
  destinationFolderId: z.string().nullable().optional(),
  destinationFolderName: z.string().nullable().optional(),
  /** Set only on remote jobs pointed at an HLS live stream; null means no cap applies. */
  hlsDurationSeconds: z.number().int().nullable().optional(),
  status: z.enum(uploadJobStatuses),
  progressBytes: z.number().int().nonnegative(),
  attemptCount: z.number().int().min(1),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  driveFileId: z.string().nullable().optional(),
  driveFileLink: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().min(1),
});

export type UploadJobView = z.infer<typeof UploadJobViewSchema>;

/**
 * A remote source must be a web URL. `http://` is accepted because the SSRF policy upgrades it to
 * `https://` before anything is stored or fetched, so a pasted plain-HTTP link works without the
 * transfer ever running in plaintext. Schemes that cannot be upgraded — `file:`, `ftp:`, `blob:`,
 * `data:` — stay out.
 */
const isWebUrl = (value: string): boolean =>
  value.startsWith('https://') || value.startsWith('http://');

const WEB_URL_MESSAGE = 'Remote upload source must be an http: or https: URL';

export const CreateRemoteJobSchema = z.object({
  url: z.string().url().max(2048).refine(isWebUrl, { message: WEB_URL_MESSAGE }),
  filename: z.string().min(1).max(255).optional(),
  folderId: z.string().max(128).optional(),
  /**
   * How long to record an HLS (`.m3u8`) live stream, which has no end of its own. Ignored for
   * every other source, including VOD playlists — those transfer in full.
   */
  hlsDurationSeconds: z.number().int().min(60).max(3600).optional(),
});

export type CreateRemoteJobRequest = z.infer<typeof CreateRemoteJobSchema>;

// Batch Upload Contracts
export const batchStatuses = ['queued', 'running', 'completed', 'partial', 'failed', 'canceled'] as const;
export type BatchStatus = (typeof batchStatuses)[number];

export const BatchItemInputSchema = z.object({
  url: z.string().url().max(2048).refine(isWebUrl, { message: WEB_URL_MESSAGE }),
  filename: z.string().min(1).max(255).optional(),
});

export type BatchItemInput = z.infer<typeof BatchItemInputSchema>;

export const CreateBatchRequestSchema = z.object({
  items: z.array(BatchItemInputSchema).min(1).max(MAX_BATCH_URLS),
  folderId: z.string().max(128).optional(),
});

export type CreateBatchRequest = z.infer<typeof CreateBatchRequestSchema>;

export const BatchViewSchema = z.object({
  id: z.string(),
  userId: z.string(),
  destinationFolderId: z.string().nullable().optional(),
  destinationFolderName: z.string().nullable().optional(),
  itemCount: z.number().int().min(1),
  queuedCount: z.number().int().nonnegative(),
  activeCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  canceledCount: z.number().int().nonnegative(),
  progressBytes: z.number().int().nonnegative(),
  totalKnownBytes: z.number().int().nonnegative(),
  status: z.enum(batchStatuses),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().min(1),
  jobs: z.array(UploadJobViewSchema).optional(),
});

export type BatchView = z.infer<typeof BatchViewSchema>;

export const CreateBatchResponseSchema = z.object({
  batch: BatchViewSchema,
  jobs: z.array(UploadJobViewSchema),
});

export type CreateBatchResponse = z.infer<typeof CreateBatchResponseSchema>;

export const CreateLocalJobSchema = z.object({
  filename: z.string().min(1).max(255),
  fileSize: z.number().int().min(1).max(MAX_UPLOAD_SIZE_BYTES),
  mimeType: z.string().min(1).max(128),
  folderId: z.string().max(128).optional(),
});

export type CreateLocalJobRequest = z.infer<typeof CreateLocalJobSchema>;

/**
 * A source the browser fetches itself and stages into R2, rather than one the worker downloads.
 *
 * Signed delivery links are often bound to the IP that created them, and the worker egresses from
 * Cloudflare addresses — so the only machine that can read those bytes is the user's own. The tab
 * does the fetching; from R2 onward the transfer is indistinguishable from a local upload.
 *
 * `fileSize` is `0` when the source sent no `Content-Length`, which is normal for a streamed
 * response: the real total is reported at completion instead.
 */
export const CreateRelayJobSchema = z.object({
  url: z.string().url().max(2048).refine(isWebUrl, { message: WEB_URL_MESSAGE }),
  filename: z.string().min(1).max(255).optional(),
  folderId: z.string().max(128).optional(),
  fileSize: z.number().int().min(0).max(MAX_UPLOAD_SIZE_BYTES),
  mimeType: z.string().min(1).max(128).optional(),
});

export type CreateRelayJobRequest = z.infer<typeof CreateRelayJobSchema>;

export const UploadPartEtagSchema = z.object({
  partNumber: z.number().int().min(1),
  etag: z.string().min(1),
});

export const CompleteLocalJobSchema = z.object({
  parts: z.array(UploadPartEtagSchema).min(1),
  /**
   * Bytes the client actually staged, used only when R2 cannot confirm the assembled size. Drive's
   * resumable session needs an exact total, and a relayed stream has no declared length to fall
   * back on.
   */
  totalBytes: z.number().int().min(1).max(MAX_UPLOAD_SIZE_BYTES).optional(),
});

export type CompleteLocalJobRequest = z.infer<typeof CompleteLocalJobSchema>;

// Drive Management Contracts
export const DriveItemOwnerSchema = z.object({
  displayName: z.string().optional(),
  emailAddress: z.string().optional(),
  picture: z.string().optional(),
});

export const VideoMediaMetadataSchema = z.object({
  width: z.number().int().nonnegative().nullable().optional(),
  height: z.number().int().nonnegative().nullable().optional(),
  durationMillis: z.string().or(z.number()).nullable().optional(),
});
export type VideoMediaMetadata = z.infer<typeof VideoMediaMetadataSchema>;

export function detectVideoQuality(
  videoMetadata?: { width?: number | null; height?: number | null } | null,
  filename?: string | null
): string | null {
  const rawHeight = videoMetadata?.height;
  const rawWidth = videoMetadata?.width;

  // Use the shorter dimension as the effective height for quality classification.
  // This handles portrait/rotated videos correctly — e.g., a 1080p video shot in
  // portrait mode reports as 1080×1920 from the Drive API, but should still be
  // classified as 1080p (not 1440p).
  const hasBoth = typeof rawHeight === 'number' && rawHeight > 0 && typeof rawWidth === 'number' && rawWidth > 0;
  const height = hasBoth ? Math.min(rawHeight!, rawWidth!) : rawHeight;
  const width = hasBoth ? Math.max(rawHeight!, rawWidth!) : rawWidth;

  if (typeof height === 'number' && height > 0) {
    if (height >= 2160 || (typeof width === 'number' && width >= 3840)) return '4K';
    if (height >= 1440 || (typeof width === 'number' && width >= 2560)) return '1440p';
    if (height >= 1080 || (typeof width === 'number' && width >= 1920)) return '1080p';
    if (height >= 720 || (typeof width === 'number' && width >= 1280)) return '720p';
    if (height >= 480 || (typeof width === 'number' && width >= 854)) return '480p';
    if (height >= 360) return '360p';
    if (height >= 240) return '240p';
    return `${height}p`;
  }

  if (typeof width === 'number' && width > 0) {
    if (width >= 3840) return '4K';
    if (width >= 2560) return '1440p';
    if (width >= 1920) return '1080p';
    if (width >= 1280) return '720p';
    if (width >= 854) return '480p';
    if (width >= 640) return '360p';
  }

  if (filename) {
    const match = filename.match(/(?:^|[^a-zA-Z0-9])(4k|2160p|1440p|2k|1080p|720p|480p|360p|240p)(?=[^a-zA-Z0-9]|$)/i);
    if (match) {
      const q = match[1].toUpperCase();
      if (q === '4K' || q === '2K') return q;
      return match[1].toLowerCase();
    }
  }

  return null;
}

export const DriveItemViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  isFolder: z.boolean(),
  size: z.number().int().nonnegative().nullable().optional(),
  modifiedTime: z.string().nullable().optional(),
  createdTime: z.string().nullable().optional(),
  shared: z.boolean(),
  trashed: z.boolean(),
  starred: z.boolean().optional(),
  iconLink: z.string().nullable().optional(),
  thumbnailLink: z.string().nullable().optional(),
  webViewLink: z.string().nullable().optional(),
  targetId: z.string().nullable().optional(),
  targetMimeType: z.string().nullable().optional(),
  isShortcut: z.boolean().optional(),
  canDownload: z.boolean().optional(),
  owners: z.array(DriveItemOwnerSchema).optional(),
  parents: z.array(z.string()).optional(),
  videoMediaMetadata: VideoMediaMetadataSchema.optional(),
  videoQuality: z.string().nullable().optional(),
});

export type DriveItemView = z.infer<typeof DriveItemViewSchema>;

export const DrivePageSchema = z.object({
  items: z.array(DriveItemViewSchema),
  nextPageToken: z.string().nullable().optional(),
});

export type DrivePage = z.infer<typeof DrivePageSchema>;

export const QuotaViewSchema = z.object({
  limit: z.number().nullable().optional(),
  usage: z.number(),
  usageInDrive: z.number(),
  usageInDriveTrash: z.number(),
});

export type QuotaView = z.infer<typeof QuotaViewSchema>;

export const PermissionRoleSchema = z.enum([
  'owner',
  'organizer',
  'fileOrganizer',
  'writer',
  'commenter',
  'reader',
]);
export type PermissionRole = z.infer<typeof PermissionRoleSchema>;

export const PermissionTypeSchema = z.enum(['user', 'group', 'domain', 'anyone']);
export type PermissionType = z.infer<typeof PermissionTypeSchema>;

export const PermissionViewSchema = z.object({
  id: z.string(),
  role: PermissionRoleSchema,
  type: PermissionTypeSchema,
  emailAddress: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  photoLink: z.string().nullable().optional(),
});

export type PermissionView = z.infer<typeof PermissionViewSchema>;

export const CreateFolderSchema = z.object({
  name: z.string().min(1).max(255),
  parentFolderId: z.string().max(128).optional(),
});

export type CreateFolderRequest = z.infer<typeof CreateFolderSchema>;

export const CopyFileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  parentFolderId: z.string().max(128).optional(),
});

export type CopyFileRequest = z.infer<typeof CopyFileSchema>;

export const UpdateDriveItemSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  starred: z.boolean().optional(),
  addParentFolderId: z.string().max(128).optional(),
  removeParentFolderId: z.string().max(128).optional(),
  addParents: z.array(z.string()).or(z.string()).optional(),
  removeParents: z.array(z.string()).or(z.string()).optional(),
});

export type UpdateDriveItemRequest = z.infer<typeof UpdateDriveItemSchema>;

export const AddPermissionSchema = z.object({
  role: z.enum(['writer', 'commenter', 'reader']),
  type: z.enum(['user', 'group', 'domain', 'anyone']),
  emailAddress: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(z.string().email().optional()),
});

export type AddPermissionRequest = z.infer<typeof AddPermissionSchema>;

export const UpdatePermissionSchema = z.object({
  role: z.enum(['writer', 'commenter', 'reader']),
});

export type UpdatePermissionRequest = z.infer<typeof UpdatePermissionSchema>;

// Batch Drive Operations Contracts
export const BatchOperationTypeSchema = z.enum([
  'trash',
  'restore',
  'delete',
  'star',
  'unstar',
  'move',
  'copy',
]);

export type BatchOperationType = z.infer<typeof BatchOperationTypeSchema>;

export const BatchDriveItemsSchema = z.object({
  action: BatchOperationTypeSchema,
  itemIds: z.array(z.string().min(1).max(128)).min(1).max(100),
  destinationFolderId: z.string().max(128).optional(),
  sourceParentFolderId: z.string().max(128).optional(),
});

export type BatchDriveItemsRequest = z.infer<typeof BatchDriveItemsSchema>;

export const BatchDriveResultItemSchema = z.object({
  id: z.string(),
  success: z.boolean(),
  item: DriveItemViewSchema.optional(),
  error: z.string().optional(),
});

export type BatchDriveResultItem = z.infer<typeof BatchDriveResultItemSchema>;

export const BatchDriveResponseSchema = z.object({
  success: z.boolean(),
  action: BatchOperationTypeSchema,
  results: z.array(BatchDriveResultItemSchema),
  total: z.number(),
  succeeded: z.number(),
  failed: z.number(),
});

export type BatchDriveResponse = z.infer<typeof BatchDriveResponseSchema>;

// Archive Extraction Contracts
export const ExtractInitSchema = z.object({
  fileId: z.string().min(1).max(128),
});

export interface ExtractInitResult {
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;
  accessToken: string;
  extractMeHost: string;
  streamUrl?: string;
}

export const ExtractUploadSchema = z.object({
  downloadUrl: z.string().url().max(2048),
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().nonnegative().optional(),
  destinationFolderId: z.string().max(128).optional(),
});

export type ExtractUploadRequest = z.infer<typeof ExtractUploadSchema>;

/**
 * One control message for server-side archive ingestion. The browser sends only this
 * small metadata envelope per chunk; the worker reads the actual archive bytes from
 * Google Drive (via `fileId` + the derived byte range) and relays them to extract.me's
 * Flow.js upload endpoint, so the archive never travels through the user's connection.
 */
export const ExtractIngestSchema = z.object({
  fileId: z.string().min(1).max(256),
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().nonnegative(),
  chunkNumber: z.number().int().positive(),
  chunkSize: z.number().int().positive().max(64 * 1024 * 1024),
  totalChunks: z.number().int().positive(),
  identifier: z.string().min(1).max(512),
  uid: z.string().min(1).max(128),
  host: z.string().min(1).max(128),
});

export type ExtractIngestRequest = z.infer<typeof ExtractIngestSchema>;

export interface ExtractIngestResult {
  /** The extract.me host that accepted the chunk (may differ from the requested host on chunk 1 fallback). */
  host: string;
  /** Present only once the final chunk assembles the archive; null for intermediate chunks. */
  tmpFilename: string | null;
}

export interface ExtractUploadResult {
  fileId: string;
  fileName: string;
  folderId?: string;
}

export const ARCHIVE_MIME_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-rar',
  'application/x-7z-compressed',
  'application/gzip',
  'application/x-gzip',
  'application/x-tar',
  'application/x-bzip2',
  'application/x-xz',
  'application/x-lzma',
  'application/x-compress',
] as const;

export const ARCHIVE_EXTENSIONS = [
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.tgz',
  '.tar.gz',
  '.tar.bz2',
  '.bz2',
  '.xz',
  '.lzma',
  '.cab',
  '.iso',
  '.dmg',
  '.jar',
  '.war',
  '.001',
] as const;
