import { Env } from '../env';
import { encryptSecret, decryptSecret } from './crypto';

const BASE_API_URL = 'https://www.seedr.cc/api';
const OAUTH_URL = 'https://www.seedr.cc/oauth_test';
const RESOURCE_URL = `${OAUTH_URL}/resource.php`;
const TOKEN_URL = `${OAUTH_URL}/token.php`;
const DEVICE_CODE_URL = `${BASE_API_URL}/device/code`;
const DEVICE_AUTHORIZE_URL = `${BASE_API_URL}/device/authorize`;
const DEVICE_CLIENT_ID = 'seedr_xbmc';

export interface SeedrDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export interface SeedrTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
}

export interface SeedrTorrentItem {
  id: number | string;
  name: string;
  progress: number;
  size: number;
  status: string;
}

export interface SeedrFolderItem {
  id: number | string;
  name: string;
  size: number;
}

export interface SeedrFileItem {
  id: number | string;
  name: string;
  size: number;
}

export interface SeedrContentsResponse {
  space_used?: number;
  space_max?: number;
  torrents: SeedrTorrentItem[];
  folders: SeedrFolderItem[];
  files: SeedrFileItem[];
}

/**
 * 1. Step 1 of Device Code Flow: Get device and user code
 */
export async function getSeedrDeviceCode(): Promise<SeedrDeviceCodeResponse> {
  const url = `${DEVICE_CODE_URL}?client_id=${encodeURIComponent(DEVICE_CLIENT_ID)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to request Seedr device code (${res.status})`);
  }
  const data = (await res.json()) as SeedrDeviceCodeResponse;
  return data;
}

/**
 * 2. Step 2 of Device Code Flow: Poll for authorization
 */
export async function pollSeedrDeviceAuthorization(
  deviceCode: string
): Promise<{ status: boolean; tokens?: SeedrTokenResponse; response?: string }> {
  const url = `${DEVICE_AUTHORIZE_URL}?client_id=${encodeURIComponent(
    DEVICE_CLIENT_ID
  )}&device_code=${encodeURIComponent(deviceCode)}`;
  const res = await fetch(url);
  if (!res.ok) {
    return { status: false, response: `HTTP_${res.status}` };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (typeof data.access_token === 'string' && data.access_token.trim().length > 0) {
    return {
      status: true,
      tokens: {
        access_token: data.access_token.trim(),
        refresh_token: String(data.refresh_token || ''),
        expires_in: Number(data.expires_in || 3600),
      },
    };
  }

  return {
    status: false,
    response:
      typeof data.error === 'string'
        ? data.error
        : typeof data.response === 'string'
        ? data.response
        : 'pending',
  };
}

/**
 * 3. Refresh expired Seedr token
 */
export async function refreshSeedrToken(refreshToken: string): Promise<SeedrTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: DEVICE_CLIENT_ID,
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Failed to refresh Seedr access token (${res.status})`);
  }

  return (await res.json()) as SeedrTokenResponse;
}

/**
 * 4. Authenticate directly via Seedr Username & Password
 */
export async function loginWithSeedrPassword(
  username: string,
  password: string
): Promise<SeedrTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'seedr_chrome',
    type: 'login',
    username,
    password,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error_description || json.error || 'Invalid Seedr email or password. Please check your credentials.'
    );
  }

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token || '',
    expires_in: json.expires_in || 3600,
  };
}

/**
 * Save encrypted Seedr tokens in D1
 */
export async function saveSeedrCredentials(
  env: Env,
  userId: string,
  accessToken: string,
  refreshToken?: string,
  username?: string
): Promise<void> {
  const encAccess = await encryptSecret(accessToken, env.TOKEN_ENCRYPTION_KEY, userId);
  const encAccessStr = `${encAccess.ciphertext}:${encAccess.iv}`;

  let encRefreshStr: string | null = null;
  if (refreshToken) {
    const encRefresh = await encryptSecret(refreshToken, env.TOKEN_ENCRYPTION_KEY, userId);
    encRefreshStr = `${encRefresh.ciphertext}:${encRefresh.iv}`;
  }

  await env.DB.prepare(
    `INSERT INTO seedr_credentials (user_id, encrypted_access_token, encrypted_refresh_token, seedr_username, updated_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT (user_id) DO UPDATE SET
       encrypted_access_token = excluded.encrypted_access_token,
       encrypted_refresh_token = COALESCE(excluded.encrypted_refresh_token, seedr_credentials.encrypted_refresh_token),
       seedr_username = COALESCE(excluded.seedr_username, seedr_credentials.seedr_username),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  )
    .bind(userId, encAccessStr, encRefreshStr, username || null)
    .run();
}

/**
 * Retrieve decrypted Seedr tokens for a user
 */
export async function getSeedrCredentials(
  env: Env,
  userId: string
): Promise<{ accessToken: string; refreshToken?: string; username?: string } | null> {
  const row = await env.DB.prepare(
    `SELECT encrypted_access_token, encrypted_refresh_token, seedr_username
     FROM seedr_credentials
     WHERE user_id = ?`
  )
    .bind(userId)
    .first<{
      encrypted_access_token: string;
      encrypted_refresh_token: string | null;
      seedr_username: string | null;
    }>();

  if (!row) return null;

  try {
    const [accessCipher, accessIv] = row.encrypted_access_token.split(':');
    const accessToken = await decryptSecret(accessCipher, accessIv, env.TOKEN_ENCRYPTION_KEY, userId);

    let refreshToken: string | undefined;
    if (row.encrypted_refresh_token) {
      const [refreshCipher, refreshIv] = row.encrypted_refresh_token.split(':');
      refreshToken = await decryptSecret(refreshCipher, refreshIv, env.TOKEN_ENCRYPTION_KEY, userId);
    }

    return {
      accessToken,
      refreshToken,
      username: row.seedr_username || undefined,
    };
  } catch (err) {
    console.error('Failed to decrypt Seedr credentials:', err);
    return null;
  }
}

/**
 * Disconnect Seedr account
 */
export async function deleteSeedrCredentials(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM seedr_credentials WHERE user_id = ?`).bind(userId).run();
}

/**
 * Execute Seedr API request with automatic token refresh on 401
 */
async function callSeedrApi(
  env: Env,
  userId: string,
  action: string,
  formData: Record<string, string>
): Promise<any> {
  const creds = await getSeedrCredentials(env, userId);
  if (!creds) {
    throw new Error('Seedr account is not connected');
  }

  const doRequest = async (token: string) => {
    const body = new URLSearchParams({ action, ...formData });
    return fetch(RESOURCE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
  };

  let res = await doRequest(creds.accessToken);

  if (res.status === 401 && creds.refreshToken) {
    // Attempt token refresh
    try {
      const refreshed = await refreshSeedrToken(creds.refreshToken);
      await saveSeedrCredentials(
        env,
        userId,
        refreshed.access_token,
        refreshed.refresh_token || creds.refreshToken,
        creds.username
      );
      res = await doRequest(refreshed.access_token);
    } catch (refreshErr) {
      throw new Error('Seedr session expired. Please re-authorize Seedr in Settings.');
    }
  }

  if (!res.ok) {
    throw new Error(`Seedr API request failed (${res.status})`);
  }

  const json = (await res.json()) as Record<string, any>;
  if (json.result === false && json.error) {
    throw new Error(String(json.error || 'Seedr operation failed'));
  }

  return json;
}

/**
 * 4. Add Magnet Link / Torrent to Seedr Cloud
 */
export async function addSeedrMagnet(
  env: Env,
  userId: string,
  magnetLink: string,
  folderId = '0'
): Promise<{ result: boolean; user_torrent_id?: number | string; title?: string }> {
  return callSeedrApi(env, userId, 'add_torrent', {
    torrent_magnet: magnetLink,
    folder_id: folderId,
  });
}

/**
 * 5. List Contents & Torrents on Seedr Cloud
 */
export async function getSeedrContents(
  env: Env,
  userId: string,
  folderId = '0'
): Promise<SeedrContentsResponse> {
  const data = await callSeedrApi(env, userId, 'list_contents', { folder_id: folderId });
  return {
    space_used: data.space_used || data.space_used_in_bytes,
    space_max: data.space_max || data.space_max_in_bytes,
    torrents: Array.isArray(data.torrents) ? data.torrents : [],
    folders: Array.isArray(data.folders) ? data.folders : [],
    files: Array.isArray(data.files) ? data.files : [],
  };
}

/**
 * 6. Fetch Direct Download URL for a completed Seedr file
 */
export async function fetchSeedrFileUrl(
  env: Env,
  userId: string,
  folderFileId: string | number
): Promise<string> {
  const data = await callSeedrApi(env, userId, 'fetch_file', {
    folder_file_id: String(folderFileId),
  });
  if (!data.url) {
    throw new Error('Seedr did not return a valid download URL');
  }
  return String(data.url);
}

/**
 * 7. Create Archive URL for a completed Seedr folder
 */
export async function createSeedrArchiveUrl(
  env: Env,
  userId: string,
  folderId: string | number
): Promise<string> {
  const data = await callSeedrApi(env, userId, 'create_archive', {
    folder_id: String(folderId),
  });
  const url = data.archive_url || data.url;
  if (!url) {
    throw new Error('Seedr did not return a valid archive URL');
  }
  return String(url);
}

/**
 * 8. Delete file/folder/torrent from Seedr Cloud to free 2GB quota
 */
export async function deleteSeedrItem(
  env: Env,
  userId: string,
  itemType: 'torrent' | 'folder' | 'file',
  itemId: string | number
): Promise<void> {
  try {
    const deleteArr = JSON.stringify([{ type: itemType, id: itemId }]);
    await callSeedrApi(env, userId, 'delete', { delete_arr: deleteArr });
  } catch (err) {
    console.warn(`Failed to cleanup Seedr item ${itemType}#${itemId}:`, err);
  }
}

export interface SeedrAccountSettings {
  username?: string;
  email?: string;
  isPremium: boolean;
  packageName?: string;
  spaceUsed: number;
  spaceMax: number;
  bandwidthUsed?: number;
  bandwidthMax?: number;
}

/**
 * 9. Fetch Seedr User Settings (Premium tier, total quota, account info)
 */
export async function getSeedrSettings(
  env: Env,
  userId: string
): Promise<SeedrAccountSettings> {
  const data = await callSeedrApi(env, userId, 'get_settings', {});
  const account = data.account || {};
  const isPremium =
    account.premium === 1 ||
    account.premium === true ||
    data.is_premium === 1 ||
    data.is_premium === true;
  const packageName =
    account.package_name || (isPremium ? 'Premium' : 'Free');
  const spaceUsed = Number(account.space_used || data.space_used || 0);
  const spaceMax = Number(account.space_max || data.space_max || 2147483648);

  return {
    username: account.username || account.email,
    email: account.email,
    isPremium,
    packageName,
    spaceUsed,
    spaceMax,
    bandwidthUsed: account.bandwidth_used,
    bandwidthMax: data.bandwidth_max,
  };
}
