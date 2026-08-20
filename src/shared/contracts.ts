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
  iconLink: z.string().nullable().optional(),
  thumbnailLink: z.string().nullable().optional(),
  webViewLink: z.string().nullable().optional(),
  owners: z.array(DriveItemOwnerSchema).optional(),
  parents: z.array(z.string()).optional(),
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

export const UpdateDriveItemSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  addParentFolderId: z.string().max(128).optional(),
  removeParentFolderId: z.string().max(128).optional(),
});

export type UpdateDriveItemRequest = z.infer<typeof UpdateDriveItemSchema>;

export const AddPermissionSchema = z.object({
  role: z.enum(['writer', 'commenter', 'reader']),
  type: z.enum(['user', 'group', 'domain', 'anyone']),
  emailAddress: z.string().email().optional(),
});

export type AddPermissionRequest = z.infer<typeof AddPermissionSchema>;

export const UpdatePermissionSchema = z.object({
  role: z.enum(['writer', 'commenter', 'reader']),
});

export type UpdatePermissionRequest = z.infer<typeof UpdatePermissionSchema>;
