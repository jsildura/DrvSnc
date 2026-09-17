import { Env } from '../env';
import { decryptSecret } from './crypto';
import { refreshAccessToken } from './googleAuth';
import {
  DriveItemView,
  DrivePage,
  QuotaView,
  PermissionView,
  PermissionRole,
  PermissionType,
  detectVideoQuality,
  BatchOperationType,
  BatchDriveResultItem,
  BatchDriveResponse,
} from '../../shared/contracts';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

export class DriveError extends Error {
  status: number;
  code: string;
  retriable: boolean;

  constructor(status: number, code: string, message: string, retriable: boolean) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
    this.code = code;
    this.retriable = retriable;
  }
}

export function escapeQueryString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Drive answers a `pageSize` outside 1..1000 with an opaque 400, which reaches the user as
 * "Failed to list folders" with nothing to act on. Every listing route parses this straight off the
 * query string with `parseInt`, so `?pageSize=-5` and `?pageSize=5000` both get that far — the
 * `|| fallback` idiom these call sites used only caught `NaN` and `0` because both are falsy.
 *
 * Same treatment `clampQueryInt`/`clampPageLimit` already give the job and batch listings.
 */
const DRIVE_MAX_PAGE_SIZE = 1000;

function clampPageSize(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.trunc(value), DRIVE_MAX_PAGE_SIZE);
}

// Google Workspace documents have no binary content, so `alt=media` never works on
// them — they have to go through /export with one of these MIME types. Order matters:
// the first entry is what we export as by default, and the rest are tried in turn if
// Google refuses the preferred one.
const WORKSPACE_EXPORT_MIME_TYPES: Record<string, string[]> = {
  'application/vnd.google-apps.document': [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ],
  'application/vnd.google-apps.spreadsheet': [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
  ],
  'application/vnd.google-apps.presentation': [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
  'application/vnd.google-apps.drawing': [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/svg+xml',
  ],
};

/**
 * Every MIME type `mimeType` can be exported as, preferred first, or null if it is
 * not a Workspace type (i.e. it should be downloaded with alt=media instead).
 */
export function getExportMimeTypes(mimeType: string): string[] | null {
  return WORKSPACE_EXPORT_MIME_TYPES[mimeType] ?? null;
}

export function getExportMimeType(mimeType: string, requestedMimeType?: string): string | null {
  const allowed = getExportMimeTypes(mimeType);
  if (!allowed) return null;

  if (requestedMimeType && allowed.includes(requestedMimeType)) {
    return requestedMimeType;
  }
  return allowed[0] || 'application/pdf';
}

export function normalizeDriveItem(raw: Record<string, unknown>): DriveItemView {
  const shortcutDetails = raw.shortcutDetails as Record<string, unknown> | undefined;
  const targetId = typeof shortcutDetails?.targetId === 'string' ? shortcutDetails.targetId : undefined;
  const targetMimeType = typeof shortcutDetails?.targetMimeType === 'string' ? shortcutDetails.targetMimeType : undefined;
  const isShortcut = raw.mimeType === 'application/vnd.google-apps.shortcut';
  const isShortcutFolder = isShortcut && targetMimeType === 'application/vnd.google-apps.folder';
  const isFolder = raw.mimeType === 'application/vnd.google-apps.folder' || isShortcutFolder;
  const rawSize = raw.size as string | number | undefined;
  const size =
    isFolder || rawSize === undefined || rawSize === null
      ? null
      : typeof rawSize === 'number'
      ? rawSize
      : parseInt(rawSize, 10);

  const rawOwners = Array.isArray(raw.owners) ? (raw.owners as Record<string, unknown>[]) : null;
  const owners = rawOwners
    ? rawOwners.map((o) => ({
        displayName: typeof o.displayName === 'string' ? o.displayName : undefined,
        emailAddress: typeof o.emailAddress === 'string' ? o.emailAddress : undefined,
        picture: typeof o.photoLink === 'string' ? o.photoLink : undefined,
      }))
    : undefined;

  return {
    id: String(raw.id || ''),
    name: String(raw.name || ''),
    mimeType: String(raw.mimeType || 'application/octet-stream'),
    isFolder,
    size: isNaN(size as number) ? null : size,
    modifiedTime: typeof raw.modifiedTime === 'string' ? raw.modifiedTime : null,
    createdTime: typeof raw.createdTime === 'string' ? raw.createdTime : null,
    shared: Boolean(raw.shared),
    trashed: Boolean(raw.trashed),
    starred: Boolean(raw.starred),
    iconLink: typeof raw.iconLink === 'string' ? raw.iconLink : null,
    thumbnailLink: typeof raw.thumbnailLink === 'string' ? raw.thumbnailLink : null,
    webViewLink: typeof raw.webViewLink === 'string' ? raw.webViewLink : null,
    targetId,
    targetMimeType,
    isShortcut,
    canDownload:
      typeof (raw.capabilities as Record<string, unknown> | undefined)?.canDownload === 'boolean'
        ? ((raw.capabilities as Record<string, unknown>).canDownload as boolean)
        : undefined,
    owners,
    parents: Array.isArray(raw.parents) ? (raw.parents as string[]) : undefined,
    videoMediaMetadata: raw.videoMediaMetadata
      ? {
          width:
            typeof (raw.videoMediaMetadata as Record<string, unknown>).width === 'number'
              ? ((raw.videoMediaMetadata as Record<string, unknown>).width as number)
              : (raw.videoMediaMetadata as Record<string, unknown>).width
              ? parseInt(String((raw.videoMediaMetadata as Record<string, unknown>).width), 10) || undefined
              : undefined,
          height:
            typeof (raw.videoMediaMetadata as Record<string, unknown>).height === 'number'
              ? ((raw.videoMediaMetadata as Record<string, unknown>).height as number)
              : (raw.videoMediaMetadata as Record<string, unknown>).height
              ? parseInt(String((raw.videoMediaMetadata as Record<string, unknown>).height), 10) || undefined
              : undefined,
          durationMillis:
            typeof (raw.videoMediaMetadata as Record<string, unknown>).durationMillis === 'number' ||
            typeof (raw.videoMediaMetadata as Record<string, unknown>).durationMillis === 'string'
              ? ((raw.videoMediaMetadata as Record<string, unknown>).durationMillis as string | number)
              : undefined,
        }
      : undefined,
    videoQuality: detectVideoQuality(
      raw.videoMediaMetadata as { width?: number | null; height?: number | null } | undefined,
      String(raw.name || '')
    ),
  };
}

/**
 * Google throttles the Drive API two different ways: a bare `429`, and — more often — a `403`
 * whose error body carries one of these reasons. The status alone makes that 403 look like a flat
 * "permission denied", so without inspecting the reason a transient throttle is surfaced to the
 * user as a hard failure and never retried. This set is what tells the two apart.
 */
const RETRIABLE_403_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'dailyLimitExceeded',
  'sharingRateLimitExceeded',
  'backendError',
  'internalError',
]);

/** Bounds on the jittered exponential backoff between throttled Drive attempts. */
const DRIVE_MAX_RETRIES = 5;
const DRIVE_BACKOFF_BASE_MS = 500;
const DRIVE_BACKOFF_CAP_MS = 32_000;

/**
 * Cap on Drive requests in flight from this isolate at once. Google's per-project limit is shared
 * across every user, so an unbounded fan-out — a bulk import, or a `listShared` page firing its own
 * parallel folder+file queries — is what tips the whole project over the edge. This is the backstop
 * that keeps a burst from becoming a self-inflicted 429.
 */
const DRIVE_MAX_CONCURRENCY = 6;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let activeDriveRequests = 0;
const driveWaiters: Array<() => void> = [];

/** Run `task` once a Drive concurrency slot is free, releasing it (even on failure) when done. */
async function withDriveSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeDriveRequests >= DRIVE_MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => driveWaiters.push(resolve));
  }
  activeDriveRequests++;
  try {
    return await task();
  } finally {
    activeDriveRequests--;
    const next = driveWaiters.shift();
    if (next) next();
  }
}

/**
 * Honour a `Retry-After`, which Google sends on some throttles as either a seconds count or an HTTP
 * date. Returns null when the header is absent or unparseable, leaving the caller on exponential
 * backoff instead.
 */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

/**
 * Full-jitter exponential backoff: a uniform random point in [0, base * 2^attempt], capped. The
 * jitter is what keeps many callers throttled at the same instant from retrying in a synchronised
 * thundering herd — the failure mode fixed-delay backoff walks straight into.
 */
function backoffDelayMs(attempt: number): number {
  const ceiling = Math.min(DRIVE_BACKOFF_CAP_MS, DRIVE_BACKOFF_BASE_MS * 2 ** attempt);
  return Math.random() * ceiling;
}

/**
 * Pull Google's machine-readable error `reason` out of a failed response without disturbing the
 * body the caller still needs. Reads a clone, tolerates a non-JSON body, and returns undefined when
 * there is nothing usable — callers then map on the status alone.
 */
async function extractErrorReason(res: Response): Promise<string | undefined> {
  try {
    const data = (await res.clone().json()) as {
      error?: { errors?: Array<{ reason?: string }>; status?: string };
    };
    return data.error?.errors?.[0]?.reason || data.error?.status || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The single choke point every Drive HTTP call goes through. It bounds outbound concurrency and, on
 * a throttle (`429`, or a `403` with a rate-limit reason) or a transient `5xx`, retries with
 * jittered exponential backoff — preferring Google's own `Retry-After` when it sends one. The
 * response is returned untouched (success bodies are never read here), so callers keep their
 * existing handling of 200/206/308/204 and their own error mapping for whatever finally comes back.
 */
async function driveFetch(
  input: string | URL,
  init?: RequestInit,
  options?: { maxRetries?: number }
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? DRIVE_MAX_RETRIES;
  for (let attempt = 0; ; attempt++) {
    const res = await withDriveSlot(() => fetch(input, init));

    // All "as expected" for one Drive call or another (ranged read, resumable progress, empty
    // delete), so never treated as a failure worth retrying.
    if (res.ok || res.status === 206 || res.status === 308 || res.status === 204) {
      return res;
    }

    let retriable = res.status === 429 || res.status >= 500;
    if (!retriable && res.status === 403) {
      const reason = await extractErrorReason(res);
      retriable = reason !== undefined && RETRIABLE_403_REASONS.has(reason);
    }

    if (!retriable || attempt >= maxRetries) {
      return res;
    }

    await sleep(parseRetryAfterMs(res.headers.get('Retry-After')) ?? backoffDelayMs(attempt));
  }
}

/**
 * Map a failed Drive response to a `DriveError`, using the body's reason to tell a throttle apart
 * from a genuine permission denial (a distinction the status code alone hides for 403).
 */
async function driveErrorFromResponse(res: Response): Promise<DriveError> {
  const reason = await extractErrorReason(res);
  const mapped = mapDriveError(res.status, reason);
  return new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
}

export function mapDriveError(
  status: number,
  reason?: string
): { code: string; message: string; retriable: boolean } {
  switch (status) {
    case 401:
      return {
        code: 'DRIVE_UNAUTHORIZED',
        message: 'Google authentication expired or invalid',
        retriable: false,
      };
    case 403:
      // A 403 is Drive's usual way of saying "slow down" (reason `userRateLimitExceeded` and
      // friends), not only "no access". Retry the throttle; keep a genuine permission denial fatal.
      if (reason && RETRIABLE_403_REASONS.has(reason)) {
        return {
          code: 'DRIVE_RATE_LIMIT_EXCEEDED',
          message: 'Google Drive API rate limit reached, please retry later',
          retriable: true,
        };
      }
      return {
        code: 'DRIVE_FORBIDDEN',
        message: 'Permission denied on Google Drive resource',
        retriable: false,
      };
    case 404:
      return {
        code: 'DRIVE_NOT_FOUND',
        message: 'Google Drive resource not found',
        retriable: false,
      };
    case 429:
      return {
        code: 'DRIVE_RATE_LIMIT_EXCEEDED',
        message: 'Google Drive API rate limit reached, please retry later',
        retriable: true,
      };
    default:
      return {
        code: status >= 500 ? 'DRIVE_UPSTREAM_ERROR' : 'DRIVE_REQUEST_FAILED',
        message: 'Google Drive operation failed',
        retriable: status >= 500,
      };
  }
}

interface CachedAccessToken {
  accessToken: string;
  expiresAt: number;
}

const accessTokenCache = new Map<string, CachedAccessToken>();

export function invalidateTokenCache(userId: string): void {
  accessTokenCache.delete(userId);
}

export async function getValidAccessToken(
  env: Env,
  userId: string,
  forceRefresh = false
): Promise<string> {
  const cached = accessTokenCache.get(userId);
  const now = Date.now();

  if (!forceRefresh && cached && cached.expiresAt > now + 60000) {
    return cached.accessToken;
  }

  const cred = await env.DB.prepare(
    'SELECT ciphertext, iv FROM google_credentials WHERE user_id = ?'
  )
    .bind(userId)
    .first<{ ciphertext: string; iv: string }>();

  if (!cred) {
    throw new Error('No Google credentials found for user');
  }

  const refreshToken = await decryptSecret(
    cred.ciphertext,
    cred.iv,
    env.TOKEN_ENCRYPTION_KEY,
    userId
  );

  const tokenResp = await refreshAccessToken(env, refreshToken);
  const expiresInSeconds = tokenResp.expiresIn || 3600;
  accessTokenCache.set(userId, {
    accessToken: tokenResp.accessToken,
    expiresAt: now + expiresInSeconds * 1000,
  });

  return tokenResp.accessToken;
}

export async function withDriveAuth<T>(
  env: Env,
  userId: string,
  fn: (token: string) => Promise<T>
): Promise<T> {
  const token = await getValidAccessToken(env, userId);
  try {
    return await fn(token);
  } catch (err: unknown) {
    const errorWithStatus = err as { status?: number };
    if (errorWithStatus && errorWithStatus.status === 401) {
      invalidateTokenCache(userId);
      const freshToken = await getValidAccessToken(env, userId, true);
      return await fn(freshToken);
    }
    throw err;
  }
}

const DRIVE_FILE_FIELDS =
  'id,name,mimeType,size,modifiedTime,createdTime,shared,trashed,starred,iconLink,thumbnailLink,webViewLink,owners,parents,videoMediaMetadata,shortcutDetails(targetId,targetMimeType),capabilities(canDownload)';

export async function listItems(
  env: Env,
  userId: string,
  options?: {
    parentFolderId?: string;
    query?: string;
    pageSize?: number;
    pageToken?: string;
    orderBy?: string;
  }
): Promise<DrivePage> {
  return withDriveAuth(env, userId, async (token) => {
    const url = new URL(`${DRIVE_API_BASE}/files`);
    const qParts: string[] = ['trashed = false'];

    if (options?.parentFolderId) {
      qParts.push(`'${escapeQueryString(options.parentFolderId)}' in parents`);
    } else if (!options?.query) {
      qParts.push("'root' in parents");
    }

    if (options?.query) {
      const trimmed = options.query.trim();
      const token = trimmed.replace(/^\.+/, '');
      const escaped = escapeQueryString(token || trimmed);
      if (escaped) {
        qParts.push(`name contains '${escaped}'`);
      }
    }

    url.searchParams.set('q', qParts.join(' and '));
    url.searchParams.set('fields', `nextPageToken,files(${DRIVE_FILE_FIELDS})`);
    url.searchParams.set('pageSize', String(clampPageSize(options?.pageSize, 50)));
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    if (options?.pageToken) url.searchParams.set('pageToken', options.pageToken);
    url.searchParams.set(
      'orderBy',
      options?.orderBy || 'folder,modifiedTime desc,name'
    );

    const res = await driveFetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    const data = (await res.json()) as {
      files?: Record<string, unknown>[];
      nextPageToken?: string | null;
    };
    return {
      items: (data.files || []).map(normalizeDriveItem),
      nextPageToken: data.nextPageToken || null,
    };
  });
}

export async function listFolders(
  env: Env,
  userId: string,
  options?: { parentFolderId?: string; pageSize?: number; pageToken?: string }
): Promise<DrivePage> {
  return withDriveAuth(env, userId, async (token) => {
    const url = new URL(`${DRIVE_API_BASE}/files`);
    const qParts = ["mimeType = 'application/vnd.google-apps.folder'", 'trashed = false'];

    if (options?.parentFolderId) {
      qParts.push(`'${escapeQueryString(options.parentFolderId)}' in parents`);
    } else {
      qParts.push("'root' in parents");
    }

    url.searchParams.set('q', qParts.join(' and '));
    url.searchParams.set('fields', `nextPageToken,files(${DRIVE_FILE_FIELDS})`);
    url.searchParams.set('pageSize', String(clampPageSize(options?.pageSize, 100)));
    if (options?.pageToken) url.searchParams.set('pageToken', options.pageToken);
    url.searchParams.set('orderBy', 'name');

    const res = await driveFetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    const data = (await res.json()) as {
      files?: Record<string, unknown>[];
      nextPageToken?: string | null;
    };
    return {
      items: (data.files || []).map(normalizeDriveItem),
      nextPageToken: data.nextPageToken || null,
    };
  });
}

export async function getFolder(
  env: Env,
  userId: string,
  folderId: string
): Promise<DriveItemView> {
  return withDriveAuth(env, userId, async (token) => {
    const url = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}`);
    url.searchParams.set('fields', DRIVE_FILE_FIELDS);
    url.searchParams.set('supportsAllDrives', 'true');

    const res = await driveFetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const item = normalizeDriveItem(data);
    if (!item.isFolder) {
      throw new DriveError(400, 'INVALID_FOLDER', 'Target ID is not a Google Drive folder', false);
    }
    return item;
  });
}

export async function createFolder(
  env: Env,
  userId: string,
  name: string,
  parentFolderId?: string
): Promise<DriveItemView> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await driveFetch(`${DRIVE_API_BASE}/files?fields=${DRIVE_FILE_FIELDS}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentFolderId ? [parentFolderId] : undefined,
      }),
    });

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    const data = (await res.json()) as Record<string, unknown>;
    return normalizeDriveItem(data);
  });
}

export async function searchItems(
  env: Env,
  userId: string,
  query: string,
  options?: { pageSize?: number; pageToken?: string }
): Promise<DrivePage> {
  return withDriveAuth(env, userId, async (token) => {
    const url = new URL(`${DRIVE_API_BASE}/files`);
    const trimmed = query.trim();
    const cleanTerm = trimmed.replace(/^\.+/, '');
    const escaped = escapeQueryString(cleanTerm || trimmed);
    const qParts = ['trashed = false'];
    if (escaped) {
      qParts.push(`(name contains '${escaped}' or fullText contains '${escaped}')`);
    }
    url.searchParams.set('q', qParts.join(' and '));
    url.searchParams.set('fields', `nextPageToken,files(${DRIVE_FILE_FIELDS})`);
    url.searchParams.set('pageSize', String(clampPageSize(options?.pageSize, 100)));
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    if (options?.pageToken) url.searchParams.set('pageToken', options.pageToken);

    const res = await driveFetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    const data = (await res.json()) as {
      files?: Record<string, unknown>[];
      nextPageToken?: string | null;
    };
    return {
      items: (data.files || []).map(normalizeDriveItem),
      nextPageToken: data.nextPageToken || null,
    };
  });
}

export async function listShared(
  env: Env,
  userId: string,
  options?: { pageSize?: number; pageToken?: string; query?: string }
): Promise<DrivePage> {
  return withDriveAuth(env, userId, async (token) => {
    const isFirstPage = !options?.pageToken;
    const pageSize = clampPageSize(options?.pageSize, 50);

    const buildUrl = (q: string, size: number, orderBy: string, pageToken?: string) => {
      const url = new URL(`${DRIVE_API_BASE}/files`);
      url.searchParams.set('q', q);
      url.searchParams.set('fields', `nextPageToken,files(${DRIVE_FILE_FIELDS})`);
      url.searchParams.set('pageSize', String(size));
      url.searchParams.set('supportsAllDrives', 'true');
      url.searchParams.set('includeItemsFromAllDrives', 'true');
      url.searchParams.set('orderBy', orderBy);
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      return url;
    };

    const mainQParts = ['sharedWithMe = true', 'trashed = false'];
    if (options?.query) {
      const trimmed = options.query.trim();
      const tokenQuery = trimmed.replace(/^\.+/, '');
      const escaped = escapeQueryString(tokenQuery || trimmed);
      if (escaped) {
        mainQParts.push(`(name contains '${escaped}' or fullText contains '${escaped}')`);
      }
    }

    const fetchFiles = async (url: URL) => {
      const res = await driveFetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw await driveErrorFromResponse(res);
      }
      return (await res.json()) as {
        files?: Record<string, unknown>[];
        nextPageToken?: string | null;
      };
    };

    // If fetching subsequent pages during infinite scroll, just fetch the next batch of items
    if (!isFirstPage) {
      const mainUrl = buildUrl(mainQParts.join(' and '), pageSize, 'sharedWithMeTime desc', options?.pageToken);
      const data = await fetchFiles(mainUrl);
      return {
        items: (data.files || []).map(normalizeDriveItem),
        nextPageToken: data.nextPageToken || null,
      };
    }

    // On first page, proactively fetch ALL shared folders (not owned by user or sharedWithMe)
    // so they are not starved or buried behind pages of recent files.
    const folderQParts = [
      'trashed = false',
      "(mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/vnd.google-apps.shortcut')",
      "(sharedWithMe = true or not 'me' in owners)",
    ];
    if (options?.query) {
      const trimmed = options.query.trim();
      const tokenQuery = trimmed.replace(/^\.+/, '');
      const escaped = escapeQueryString(tokenQuery || trimmed);
      if (escaped) {
        folderQParts.push(`(name contains '${escaped}' or fullText contains '${escaped}')`);
      }
    }

    const folderUrl = buildUrl(folderQParts.join(' and '), 100, 'folder,name');
    const mainUrl = buildUrl(mainQParts.join(' and '), pageSize, 'sharedWithMeTime desc');

    let folderFiles: Record<string, unknown>[] = [];
    let mainData: { files?: Record<string, unknown>[]; nextPageToken?: string | null } = { files: [] };

    try {
      const [foldersResult, mainResult] = await Promise.all([
        driveFetch(folderUrl.toString(), { headers: { Authorization: `Bearer ${token}` } }).then(async (r) => {
          if (!r.ok) {
            // If the broad query (not 'me' in owners) fails with 400, fallback to standard sharedWithMe
            const fallbackQ = [
              'sharedWithMe = true',
              'trashed = false',
              "(mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/vnd.google-apps.shortcut')",
            ];
            if (options?.query) {
              const trimmed = options.query.trim();
              const tokenQuery = trimmed.replace(/^\.+/, '');
              const escaped = escapeQueryString(tokenQuery || trimmed);
              if (escaped) fallbackQ.push(`(name contains '${escaped}' or fullText contains '${escaped}')`);
            }
            const fallbackUrl = buildUrl(fallbackQ.join(' and '), 100, 'folder,name');
            const fallbackRes = await driveFetch(fallbackUrl.toString(), { headers: { Authorization: `Bearer ${token}` } });
            if (!fallbackRes.ok) return { files: [] };
            return (await fallbackRes.json()) as { files?: Record<string, unknown>[] };
          }
          return (await r.json()) as { files?: Record<string, unknown>[] };
        }),
        fetchFiles(mainUrl),
      ]);
      folderFiles = foldersResult.files || [];
      mainData = mainResult;
    } catch {
      mainData = await fetchFiles(mainUrl);
    }

    const normalizedFolders = folderFiles
      .map(normalizeDriveItem)
      .filter((item) => item.isFolder);

    const normalizedMainItems = (mainData.files || []).map(normalizeDriveItem);

    const seenIds = new Set<string>();
    const merged: DriveItemView[] = [];

    for (const folder of normalizedFolders) {
      if (!seenIds.has(folder.id)) {
        seenIds.add(folder.id);
        merged.push(folder);
      }
    }

    for (const item of normalizedMainItems) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        merged.push(item);
      }
    }

    return {
      items: merged,
      nextPageToken: mainData.nextPageToken || null,
    };
  });
}

export async function listTrash(
  env: Env,
  userId: string,
  options?: { pageSize?: number; pageToken?: string }
): Promise<DrivePage> {
  return withDriveAuth(env, userId, async (token) => {
    const url = new URL(`${DRIVE_API_BASE}/files`);
    url.searchParams.set('q', 'trashed = true');
    url.searchParams.set('fields', `nextPageToken,files(${DRIVE_FILE_FIELDS})`);
    url.searchParams.set('pageSize', String(clampPageSize(options?.pageSize, 50)));
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    if (options?.pageToken) url.searchParams.set('pageToken', options.pageToken);

    const res = await driveFetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    const data = (await res.json()) as {
      files?: Record<string, unknown>[];
      nextPageToken?: string | null;
    };
    return {
      items: (data.files || []).map(normalizeDriveItem),
      nextPageToken: data.nextPageToken || null,
    };
  });
}

export async function listStarred(
  env: Env,
  userId: string,
  options?: { pageSize?: number; pageToken?: string; query?: string }
): Promise<DrivePage> {
  return withDriveAuth(env, userId, async (token) => {
    const url = new URL(`${DRIVE_API_BASE}/files`);
    const qParts: string[] = ['trashed = false', 'starred = true'];

    if (options?.query) {
      const trimmed = options.query.trim();
      const cleanTerm = trimmed.replace(/^\.+/, '');
      const escaped = escapeQueryString(cleanTerm || trimmed);
      if (escaped) {
        qParts.push(`(name contains '${escaped}' or fullText contains '${escaped}')`);
      }
    }

    url.searchParams.set('q', qParts.join(' and '));
    url.searchParams.set('fields', `nextPageToken,files(${DRIVE_FILE_FIELDS})`);
    url.searchParams.set('pageSize', String(clampPageSize(options?.pageSize, 50)));
    url.searchParams.set('orderBy', 'folder,modifiedTime desc');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    if (options?.pageToken) url.searchParams.set('pageToken', options.pageToken);

    const res = await driveFetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    const data = (await res.json()) as {
      files?: Record<string, unknown>[];
      nextPageToken?: string | null;
    };
    return {
      items: (data.files || []).map(normalizeDriveItem),
      nextPageToken: data.nextPageToken || null,
    };
  });
}

interface CachedQuota {
  quota: QuotaView;
  expiresAt: number;
}

const quotaCache = new Map<string, CachedQuota>();
const QUOTA_CACHE_TTL_MS = 60_000;

export function invalidateQuotaCache(userId?: string): void {
  if (userId) {
    quotaCache.delete(userId);
  } else {
    quotaCache.clear();
  }
}

export async function getQuota(
  env: Env,
  userId: string,
  forceRefresh = false
): Promise<QuotaView> {
  const cached = quotaCache.get(userId);
  const now = Date.now();
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.quota;
  }

  return withDriveAuth(env, userId, async (token) => {
    const res = await driveFetch(`${DRIVE_API_BASE}/about?fields=storageQuota`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    const data = (await res.json()) as {
      storageQuota?: {
        limit?: string;
        usage?: string;
        usageInDrive?: string;
        usageInDriveTrash?: string;
      };
    };

    const quota = data.storageQuota || {};
    const result: QuotaView = {
      limit: quota.limit ? parseInt(quota.limit, 10) : null,
      usage: quota.usage ? parseInt(quota.usage, 10) : 0,
      usageInDrive: quota.usageInDrive ? parseInt(quota.usageInDrive, 10) : 0,
      usageInDriveTrash: quota.usageInDriveTrash ? parseInt(quota.usageInDriveTrash, 10) : 0,
    };

    quotaCache.set(userId, {
      quota: result,
      expiresAt: now + QUOTA_CACHE_TTL_MS,
    });

    return result;
  });
}

export async function updateItem(
  env: Env,
  userId: string,
  fileId: string,
  updates: { name?: string; starred?: boolean; addParents?: string; removeParents?: string }
): Promise<DriveItemView> {
  return withDriveAuth(env, userId, async (token) => {
    const url = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`);
    url.searchParams.set('fields', DRIVE_FILE_FIELDS);
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('enforceSingleParent', 'true');
    if (updates.addParents) url.searchParams.set('addParents', updates.addParents);
    if (updates.removeParents) url.searchParams.set('removeParents', updates.removeParents);

    const body: Record<string, unknown> = {};
    if (updates.name) body.name = updates.name;
    if (updates.starred !== undefined) body.starred = updates.starred;

    const res = await driveFetch(url.toString(), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    const data = (await res.json()) as Record<string, unknown>;
    return normalizeDriveItem(data);
  });
}

export async function copyFile(
  env: Env,
  userId: string,
  fileId: string,
  options?: { name?: string; parentFolderId?: string }
): Promise<DriveItemView> {
  return withDriveAuth(env, userId, async (token) => {
    const url = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/copy`);
    url.searchParams.set('fields', DRIVE_FILE_FIELDS);
    url.searchParams.set('supportsAllDrives', 'true');

    const body: Record<string, unknown> = {};
    if (options?.name) body.name = options.name;
    if (options?.parentFolderId) body.parents = [options.parentFolderId];

    const res = await driveFetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    const data = (await res.json()) as Record<string, unknown>;
    return normalizeDriveItem(data);
  });
}

export async function trashItem(
  env: Env,
  userId: string,
  fileId: string
): Promise<DriveItemView> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await driveFetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=${DRIVE_FILE_FIELDS}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ trashed: true }),
      }
    );

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    const data = (await res.json()) as Record<string, unknown>;
    return normalizeDriveItem(data);
  });
}

export async function restoreItem(
  env: Env,
  userId: string,
  fileId: string
): Promise<DriveItemView> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await driveFetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=${DRIVE_FILE_FIELDS}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ trashed: false }),
      }
    );

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    const data = (await res.json()) as Record<string, unknown>;
    return normalizeDriveItem(data);
  });
}

export async function deleteItemPermanently(
  env: Env,
  userId: string,
  fileId: string
): Promise<void> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await driveFetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok && res.status !== 204) {
      throw await driveErrorFromResponse(res);
    }
    invalidateQuotaCache(userId);
  });
}

export async function emptyTrash(env: Env, userId: string): Promise<void> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await driveFetch(`${DRIVE_API_BASE}/files/trash`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok && res.status !== 204) {
      throw await driveErrorFromResponse(res);
    }
    invalidateQuotaCache(userId);
  });
}

export interface BatchSubrequest {
  id: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
}

export interface BatchSubresponse {
  id: string;
  status: number;
  data?: Record<string, unknown>;
  error?: string;
}

export function buildBatchMultipartBody(boundary: string, requests: BatchSubrequest[]): string {
  const parts: string[] = [];
  for (const req of requests) {
    let part = `--${boundary}\r\n`;
    part += `Content-Type: application/http\r\n`;
    part += `Content-ID: <${req.id}>\r\n\r\n`;
    part += `${req.method} ${req.path} HTTP/1.1\r\n`;
    if (req.body) {
      const jsonBody = JSON.stringify(req.body);
      part += `Content-Type: application/json; charset=UTF-8\r\n`;
      part += `Content-Length: ${jsonBody.length}\r\n\r\n`;
      part += `${jsonBody}\r\n`;
    } else {
      part += `\r\n`;
    }
    parts.push(part);
  }
  return parts.join('') + `--${boundary}--\r\n`;
}

export function parseBatchMultipartResponse(contentType: string, bodyText: string): BatchSubresponse[] {
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) {
    throw new Error('Missing boundary in batch response Content-Type');
  }
  const rawBoundary = boundaryMatch[1].trim().replace(/^"(.*)"$/, '$1');
  const boundary = `--${rawBoundary}`;
  const parts = bodyText.split(boundary);
  const results: BatchSubresponse[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === '--') continue;

    const contentIdMatch = trimmed.match(/Content-ID:\s*<?(?:response-)?([^>\r\n]+)>?/i);
    const id = contentIdMatch ? contentIdMatch[1].trim() : '';

    const statusMatch = trimmed.match(/HTTP\/1\.[01]\s+(\d{3})(?:\s+([^\r\n]*))?/i);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 500;

    let data: Record<string, unknown> | undefined;
    const statusIdx = trimmed.search(/HTTP\/1\.[01]\s+\d{3}/i);
    if (statusIdx !== -1) {
      const httpPayload = trimmed.slice(statusIdx);
      const splitPoint = httpPayload.search(/\r?\n\r?\n/);
      if (splitPoint !== -1) {
        const rawInnerBody = httpPayload.slice(splitPoint).trim();
        if (rawInnerBody) {
          try {
            data = JSON.parse(rawInnerBody);
          } catch {
            // non-json or empty body
          }
        }
      }
    }

    if (status >= 200 && status < 300) {
      results.push({ id, status, data });
    } else {
      const errMsg =
        typeof data?.error === 'object' && data?.error && 'message' in data.error
          ? String((data.error as { message: unknown }).message)
          : `Drive batch error (HTTP ${status})`;
      results.push({ id, status, error: errMsg, data });
    }
  }

  return results;
}

export async function executeBatchDriveRequests(
  env: Env,
  userId: string,
  requests: BatchSubrequest[]
): Promise<BatchSubresponse[]> {
  if (requests.length === 0) return [];

  return withDriveAuth(env, userId, async (token) => {
    const boundary = `batch_drive_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const body = buildBatchMultipartBody(boundary, requests);

    try {
      const res = await driveFetch(
        'https://www.googleapis.com/batch/drive/v3',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/mixed; boundary=${boundary}`,
          },
          body,
        },
        { maxRetries: 1 }
      );

      if (res.ok) {
        const contentType = res.headers.get('Content-Type') || '';
        const text = await res.text();
        const parsed = parseBatchMultipartResponse(contentType, text);
        if (parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Fall through to concurrent fallback execution
    }

    // Fallback: bounded concurrency individual requests
    const fallbackResults: BatchSubresponse[] = [];
    await Promise.all(
      requests.map(async (req) => {
        try {
          const url = new URL(`https://www.googleapis.com${req.path}`);
          const singleRes = await driveFetch(url.toString(), {
            method: req.method,
            headers: {
              Authorization: `Bearer ${token}`,
              ...(req.body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: req.body ? JSON.stringify(req.body) : undefined,
          });

          if (singleRes.ok || singleRes.status === 204) {
            let data: Record<string, unknown> | undefined;
            if (singleRes.status !== 204) {
              try {
                data = (await singleRes.json()) as Record<string, unknown>;
              } catch {
                // ignore
              }
            }
            fallbackResults.push({ id: req.id, status: singleRes.status, data });
          } else {
            const err = await driveErrorFromResponse(singleRes);
            fallbackResults.push({ id: req.id, status: singleRes.status, error: err.message });
          }
        } catch (e) {
          fallbackResults.push({ id: req.id, status: 500, error: (e as Error).message || 'Request failed' });
        }
      })
    );

    return fallbackResults;
  });
}

export async function batchPerformDriveAction(
  env: Env,
  userId: string,
  action: BatchOperationType,
  itemIds: string[],
  options?: {
    destinationFolderId?: string;
    sourceParentFolderId?: string;
  }
): Promise<BatchDriveResponse> {
  if (itemIds.length === 0) {
    return {
      success: true,
      action,
      results: [],
      total: 0,
      succeeded: 0,
      failed: 0,
    };
  }

  // Chunk in batches of up to 100 per Google Drive batch API limit
  const CHUNK_SIZE = 100;
  const chunks: string[][] = [];
  for (let i = 0; i < itemIds.length; i += CHUNK_SIZE) {
    chunks.push(itemIds.slice(i, i + CHUNK_SIZE));
  }

  const allSubresponses: BatchSubresponse[] = [];

  for (const chunk of chunks) {
    const subrequests: BatchSubrequest[] = chunk.map((id) => {
      const encodedId = encodeURIComponent(id);
      switch (action) {
        case 'trash':
          return {
            id,
            method: 'PATCH',
            path: `/drive/v3/files/${encodedId}?fields=${DRIVE_FILE_FIELDS}&supportsAllDrives=true`,
            body: { trashed: true },
          };
        case 'restore':
          return {
            id,
            method: 'PATCH',
            path: `/drive/v3/files/${encodedId}?fields=${DRIVE_FILE_FIELDS}&supportsAllDrives=true`,
            body: { trashed: false },
          };
        case 'star':
          return {
            id,
            method: 'PATCH',
            path: `/drive/v3/files/${encodedId}?fields=${DRIVE_FILE_FIELDS}&supportsAllDrives=true`,
            body: { starred: true },
          };
        case 'unstar':
          return {
            id,
            method: 'PATCH',
            path: `/drive/v3/files/${encodedId}?fields=${DRIVE_FILE_FIELDS}&supportsAllDrives=true`,
            body: { starred: false },
          };
        case 'delete':
          return {
            id,
            method: 'DELETE',
            path: `/drive/v3/files/${encodedId}?supportsAllDrives=true`,
          };
        case 'copy':
          return {
            id,
            method: 'POST',
            path: `/drive/v3/files/${encodedId}/copy?fields=${DRIVE_FILE_FIELDS}&supportsAllDrives=true`,
            body: options?.destinationFolderId ? { parents: [options.destinationFolderId] } : {},
          };
        case 'move': {
          let movePath = `/drive/v3/files/${encodedId}?fields=${DRIVE_FILE_FIELDS}&supportsAllDrives=true&enforceSingleParent=true`;
          if (options?.destinationFolderId) {
            movePath += `&addParents=${encodeURIComponent(options.destinationFolderId)}`;
          }
          if (options?.sourceParentFolderId) {
            movePath += `&removeParents=${encodeURIComponent(options.sourceParentFolderId)}`;
          }
          return {
            id,
            method: 'PATCH',
            path: movePath,
            body: {},
          };
        }
      }
    });

    const chunkResults = await executeBatchDriveRequests(env, userId, subrequests);
    allSubresponses.push(...chunkResults);
  }

  // Invalidate quota on mutations that affect storage
  if (action === 'trash' || action === 'restore' || action === 'delete') {
    invalidateQuotaCache(userId);
  }

  const responseMap = new Map<string, BatchSubresponse>();
  for (const resp of allSubresponses) {
    responseMap.set(resp.id, resp);
  }

  const results: BatchDriveResultItem[] = itemIds.map((id) => {
    const resp = responseMap.get(id);
    if (!resp) {
      return { id, success: false, error: 'No response received' };
    }
    const isSuccess = resp.status >= 200 && resp.status < 300;
    return {
      id,
      success: isSuccess,
      item: resp.data ? normalizeDriveItem(resp.data) : undefined,
      error: isSuccess ? undefined : (resp.error || `HTTP ${resp.status}`),
    };
  });

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;

  return {
    success: succeeded > 0 || results.length === 0,
    action,
    results,
    total: results.length,
    succeeded,
    failed,
  };
}

export async function getPermissions(
  env: Env,
  userId: string,
  fileId: string
): Promise<PermissionView[]> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await driveFetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,role,type,emailAddress,displayName,photoLink)&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    const data = (await res.json()) as {
      permissions?: {
        id: string;
        role: string;
        type: string;
        emailAddress?: string;
        displayName?: string;
        photoLink?: string;
      }[];
    };
    return (data.permissions || []).map((p) => ({
      id: p.id,
      role: p.role as PermissionRole,
      type: p.type as PermissionType,
      emailAddress: p.emailAddress || null,
      displayName: p.displayName || null,
      photoLink: p.photoLink || null,
    }));
  });
}

export async function addPermission(
  env: Env,
  userId: string,
  fileId: string,
  perm: { role: string; type: string; emailAddress?: string }
): Promise<PermissionView> {
  return withDriveAuth(env, userId, async (token) => {
    const url = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/permissions`);
    url.searchParams.set('fields', 'id,role,type,emailAddress,displayName,photoLink');
    url.searchParams.set('supportsAllDrives', 'true');

    const payload: Record<string, unknown> = {
      role: perm.role,
      type: perm.type,
    };
    if (perm.emailAddress && perm.type !== 'anyone') {
      payload.emailAddress = perm.emailAddress;
    }

    const res = await driveFetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    const p = (await res.json()) as {
      id: string;
      role: string;
      type: string;
      emailAddress?: string;
      displayName?: string;
      photoLink?: string;
    };
    return {
      id: p.id,
      role: p.role as PermissionRole,
      type: p.type as PermissionType,
      emailAddress: p.emailAddress || null,
      displayName: p.displayName || null,
      photoLink: p.photoLink || null,
    };
  });
}

export async function updatePermission(
  env: Env,
  userId: string,
  fileId: string,
  permissionId: string,
  role: string
): Promise<PermissionView> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await driveFetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?fields=id,role,type,emailAddress,displayName,photoLink&supportsAllDrives=true`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role }),
      }
    );

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    const p = (await res.json()) as {
      id: string;
      role: string;
      type: string;
      emailAddress?: string;
      displayName?: string;
      photoLink?: string;
    };
    return {
      id: p.id,
      role: p.role as PermissionRole,
      type: p.type as PermissionType,
      emailAddress: p.emailAddress || null,
      displayName: p.displayName || null,
      photoLink: p.photoLink || null,
    };
  });
}

export async function removePermission(
  env: Env,
  userId: string,
  fileId: string,
  permissionId: string
): Promise<void> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await driveFetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?supportsAllDrives=true`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!res.ok && res.status !== 204) {
      throw await driveErrorFromResponse(res);
    }
  });
}

/**
 * Fetch a single file's metadata. Unlike `getFolder` this makes no assertion about what
 * kind of item it is — the download route uses it purely to learn the mimeType so it can
 * decide between alt=media and /export.
 */
export async function getFileMetadata(
  env: Env,
  userId: string,
  fileId: string
): Promise<DriveItemView> {
  return withDriveAuth(env, userId, async (token) => {
    const url = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`);
    url.searchParams.set('fields', DRIVE_FILE_FIELDS);
    url.searchParams.set('supportsAllDrives', 'true');

    const res = await driveFetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    return normalizeDriveItem((await res.json()) as Record<string, unknown>);
  });
}

export async function downloadFile(
  env: Env,
  userId: string,
  fileId: string,
  range?: string
): Promise<Response> {
  return withDriveAuth(env, userId, async (token) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (range) {
      headers.Range = range;
    }
    const url = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`);
    url.searchParams.set('alt', 'media');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('acknowledgeAbuse', 'true');

    const res = await driveFetch(url.toString(), { headers }, { maxRetries: 0 });

    if (!res.ok && res.status !== 206) {
      throw await driveErrorFromResponse(res);
    }

    return res;
  });
}

/**
 * Backoff before re-attempting an export. Google throttles on-the-fly conversion
 * fairly aggressively, and a rendered document is worth waiting a few hundred ms for.
 * The length of this array also caps the number of retries per MIME type.
 */
const EXPORT_RETRY_DELAYS_MS = [200, 600];

async function exportFileOnce(
  env: Env,
  userId: string,
  fileId: string,
  exportMimeType: string
): Promise<Response> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await driveFetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMimeType)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
      { maxRetries: 0 }
    );

    if (!res.ok) {
      const reason = await extractErrorReason(res);
      const mapped = mapDriveError(res.status, reason);
      // Name the format in the message: "could not export as application/pdf" tells
      // the caller far more than a bare "operation failed", and this message is what
      // the preview surfaces to the user. Only a genuine 403 (permission, not a
      // throttle) means "not exportable as this format" — a rate-limit 403 keeps its
      // retriable code so the export can be re-attempted.
      const notExportable = res.status === 403 && mapped.code === 'DRIVE_FORBIDDEN';
      throw new DriveError(
        res.status,
        notExportable ? 'DRIVE_NOT_EXPORTABLE' : mapped.code,
        notExportable
          ? `Google Drive cannot export this file as ${exportMimeType}`
          : `${mapped.message} (exporting as ${exportMimeType})`,
        mapped.retriable
      );
    }

    return res;
  });
}

/**
 * Export a Google Workspace file, retrying retriable failures and falling back through
 * `fallbackMimeTypes` when Google refuses the preferred format outright.
 *
 * A 403 on /export means "not exportable as this format" rather than "no access", so it
 * is worth trying the next candidate; 429 and 5xx mean "ask again shortly", so the same
 * candidate is retried with backoff. The error thrown is the last one seen, so the
 * caller reports the reason the *final* attempt failed rather than a generic message.
 */
export async function exportFile(
  env: Env,
  userId: string,
  fileId: string,
  exportMimeType: string,
  fallbackMimeTypes: string[] = []
): Promise<Response> {
  const candidates = [
    exportMimeType,
    ...fallbackMimeTypes.filter((mime) => mime !== exportMimeType),
  ];
  let lastError: unknown;

  for (const mimeType of candidates) {
    for (let attempt = 0; attempt <= EXPORT_RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await exportFileOnce(env, userId, fileId, mimeType);
      } catch (err) {
        lastError = err;
        const retriable = (err as DriveError)?.retriable === true;
        if (!retriable || attempt === EXPORT_RETRY_DELAYS_MS.length) break;
        await sleep(EXPORT_RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  throw (
    lastError ??
    new DriveError(500, 'DRIVE_EXPORT_FAILED', 'Google Drive export produced no response', true)
  );
}

export async function createEmptyDriveFile(
  env: Env,
  userId: string,
  metadata: { name: string; mimeType: string; folderId?: string }
): Promise<{ id: string }> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await driveFetch(`${DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: metadata.name,
        mimeType: metadata.mimeType,
        parents: metadata.folderId ? [metadata.folderId] : undefined,
      }),
    });

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    return (await res.json()) as { id: string };
  });
}

export async function startResumableUpload(
  env: Env,
  userId: string,
  metadata: { name: string; mimeType: string; folderId?: string }
): Promise<string> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await driveFetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=resumable`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: metadata.name,
        mimeType: metadata.mimeType,
        parents: metadata.folderId ? [metadata.folderId] : undefined,
      }),
    });

    if (!res.ok) {
      throw await driveErrorFromResponse(res);
    }

    const location = res.headers.get('Location');
    if (!location) {
      throw new Error('Google Drive API did not return Location header for resumable upload');
    }
    return location;
  });
}

export async function queryResumableOffset(
  resumableUri: string,
  fileSize: number
): Promise<number> {
  const res = await driveFetch(resumableUri, {
    method: 'PUT',
    headers: {
      'Content-Range': `bytes */${fileSize}`,
    },
  });

  if (res.status === 308) {
    const range = res.headers.get('Range');
    if (range && range.startsWith('bytes=0-')) {
      const lastByte = parseInt(range.replace('bytes=0-', ''), 10);
      return isNaN(lastByte) ? 0 : lastByte + 1;
    }
    return 0;
  }

  if (res.status === 200 || res.status === 201) {
    return fileSize;
  }

  throw new Error(`Failed to query resumable upload offset: status ${res.status}`);
}

/**
 * Upload one chunk of a resumable session.
 *
 * `totalSize` may be `'*'` for a source whose length is not known until it ends — an HLS
 * recording, for one. Google requires that every chunk of such an upload be a multiple of
 * 256 KiB until the final one, which is what declares the real total and commits the file.
 */
export async function uploadChunk(
  resumableUri: string,
  chunk: ArrayBuffer,
  startByte: number,
  totalSize: number | '*'
): Promise<Response> {
  const endByte = startByte + chunk.byteLength - 1;
  return await driveFetch(resumableUri, {
    method: 'PUT',
    headers: {
      'Content-Range': `bytes ${startByte}-${endByte}/${totalSize}`,
      'Content-Length': String(chunk.byteLength),
    },
    body: chunk,
  });
}

/**
 * Commit an unknown-size resumable upload that has no trailing bytes left to send.
 *
 * When a recording happens to end on an exact 256 KiB boundary every byte has already been
 * accepted, so there is no final chunk left to carry the total. A `Content-Range` of
 * `bytes` then a bare asterisk over the total, sent with an empty body, is how Google is told
 * the stream is over and at what length to commit.
 */
export async function finalizeUnknownSizeUpload(
  resumableUri: string,
  totalSize: number
): Promise<Response> {
  return await driveFetch(resumableUri, {
    method: 'PUT',
    headers: {
      'Content-Range': `bytes */${totalSize}`,
      'Content-Length': '0',
    },
  });
}
