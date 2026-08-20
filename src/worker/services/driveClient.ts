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
  const isFolder = raw.mimeType === 'application/vnd.google-apps.folder';
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
    iconLink: typeof raw.iconLink === 'string' ? raw.iconLink : null,
    thumbnailLink: typeof raw.thumbnailLink === 'string' ? raw.thumbnailLink : null,
    webViewLink: typeof raw.webViewLink === 'string' ? raw.webViewLink : null,
    owners,
    parents: Array.isArray(raw.parents) ? (raw.parents as string[]) : undefined,
  };
}

export function mapDriveError(
  status: number,
  _upstreamMessage?: string
): { code: string; message: string; retriable: boolean } {
  switch (status) {
    case 401:
      return {
        code: 'DRIVE_UNAUTHORIZED',
        message: 'Google authentication expired or invalid',
        retriable: false,
      };
    case 403:
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
  'id,name,mimeType,size,modifiedTime,createdTime,shared,trashed,iconLink,thumbnailLink,webViewLink,owners,parents';

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
      qParts.push(`name contains '${escapeQueryString(options.query)}'`);
    }

    url.searchParams.set('q', qParts.join(' and '));
    url.searchParams.set('fields', `nextPageToken,files(${DRIVE_FILE_FIELDS})`);
    url.searchParams.set('pageSize', String(clampPageSize(options?.pageSize, 50)));
    if (options?.pageToken) url.searchParams.set('pageToken', options.pageToken);
    url.searchParams.set(
      'orderBy',
      options?.orderBy || 'folder,modifiedTime desc,name'
    );

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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
    const res = await fetch(`${DRIVE_API_BASE}/files?fields=${DRIVE_FILE_FIELDS}`, {
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
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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
    const escaped = escapeQueryString(query);
    url.searchParams.set(
      'q',
      `trashed = false and (name contains '${escaped}' or fullText contains '${escaped}')`
    );
    url.searchParams.set('fields', `nextPageToken,files(${DRIVE_FILE_FIELDS})`);
    url.searchParams.set('pageSize', String(clampPageSize(options?.pageSize, 50)));
    if (options?.pageToken) url.searchParams.set('pageToken', options.pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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
  options?: { pageSize?: number; pageToken?: string }
): Promise<DrivePage> {
  return withDriveAuth(env, userId, async (token) => {
    const url = new URL(`${DRIVE_API_BASE}/files`);
    url.searchParams.set('q', 'sharedWithMe = true and trashed = false');
    url.searchParams.set('fields', `nextPageToken,files(${DRIVE_FILE_FIELDS})`);
    url.searchParams.set('pageSize', String(clampPageSize(options?.pageSize, 50)));
    url.searchParams.set('orderBy', 'sharedWithMeTime desc');
    if (options?.pageToken) url.searchParams.set('pageToken', options.pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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
    if (options?.pageToken) url.searchParams.set('pageToken', options.pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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

export async function getQuota(env: Env, userId: string): Promise<QuotaView> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await fetch(`${DRIVE_API_BASE}/about?fields=storageQuota`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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
    return {
      limit: quota.limit ? parseInt(quota.limit, 10) : null,
      usage: quota.usage ? parseInt(quota.usage, 10) : 0,
      usageInDrive: quota.usageInDrive ? parseInt(quota.usageInDrive, 10) : 0,
      usageInDriveTrash: quota.usageInDriveTrash ? parseInt(quota.usageInDriveTrash, 10) : 0,
    };
  });
}

export async function updateItem(
  env: Env,
  userId: string,
  fileId: string,
  updates: { name?: string; addParents?: string; removeParents?: string }
): Promise<DriveItemView> {
  return withDriveAuth(env, userId, async (token) => {
    const url = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`);
    url.searchParams.set('fields', DRIVE_FILE_FIELDS);
    if (updates.addParents) url.searchParams.set('addParents', updates.addParents);
    if (updates.removeParents) url.searchParams.set('removeParents', updates.removeParents);

    const body: Record<string, unknown> = {};
    if (updates.name) body.name = updates.name;

    const res = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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
    const res = await fetch(
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
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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
    const res = await fetch(
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
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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
    const res = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok && res.status !== 204) {
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
    }
  });
}

export async function emptyTrash(env: Env, userId: string): Promise<void> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await fetch(`${DRIVE_API_BASE}/files/trash`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok && res.status !== 204) {
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
    }
  });
}

export async function getPermissions(
  env: Env,
  userId: string,
  fileId: string
): Promise<PermissionView[]> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await fetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,role,type,emailAddress,displayName,photoLink)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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
    const res = await fetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/permissions?fields=id,role,type,emailAddress,displayName,photoLink`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(perm),
      }
    );

    if (!res.ok) {
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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
    const res = await fetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?fields=id,role,type,emailAddress,displayName,photoLink`,
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
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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
    const res = await fetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!res.ok && res.status !== 204) {
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
    }

    return normalizeDriveItem((await res.json()) as Record<string, unknown>);
  });
}

export async function downloadFile(
  env: Env,
  userId: string,
  fileId: string
): Promise<Response> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await fetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!res.ok) {
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function exportFileOnce(
  env: Env,
  userId: string,
  fileId: string,
  exportMimeType: string
): Promise<Response> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await fetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMimeType)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!res.ok) {
      const mapped = mapDriveError(res.status);
      // Name the format in the message: "could not export as application/pdf" tells
      // the caller far more than a bare "operation failed", and this message is what
      // the preview surfaces to the user.
      throw new DriveError(
        res.status,
        res.status === 403 ? 'DRIVE_NOT_EXPORTABLE' : mapped.code,
        res.status === 403
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

export async function startResumableUpload(
  env: Env,
  userId: string,
  metadata: { name: string; mimeType: string; folderId?: string }
): Promise<string> {
  return withDriveAuth(env, userId, async (token) => {
    const res = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=resumable`, {
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
      const mapped = mapDriveError(res.status);
      throw new DriveError(res.status, mapped.code, mapped.message, mapped.retriable);
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
  const res = await fetch(resumableUri, {
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
  return await fetch(resumableUri, {
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
  return await fetch(resumableUri, {
    method: 'PUT',
    headers: {
      'Content-Range': `bytes */${totalSize}`,
      'Content-Length': '0',
    },
  });
}
