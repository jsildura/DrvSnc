// Core types for the extension

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: 'Bearer';
  id_token?: string;
  obtained_at: number;
};

export type UploadStatus =
  | 'idle'
  | 'queued'
  | 'downloading'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'canceled';

export type UploadSource = 'url' | 'local';

export type UploadJob = {
  id: string;
  source: UploadSource;
  url?: string; // for URL uploads
  file?: File; // for local file uploads (stored temporarily)
  fileId?: string; // IndexedDB file ID for local uploads
  filename: string;
  destFolderId: string;
  accountId?: string; // Which account to upload to (for multi-account)
  forceClientSide?: boolean; // Force client-side upload (for context menu)
  status: UploadStatus;
  bytesRead: number;
  bytesTotal?: number;
  bytesSent: number;
  error?: string;
  driveFileId?: string;
  driveFileUrl?: string;
  mimeType?: string; // MIME type of the file if known
  fileSize?: number; // File size in bytes if known (alias/fallback for bytesTotal)
  createdAt: number;
  updatedAt: number;
};

export type DriveFolder = {
  id: string;
  name: string;
  parents?: string[]; // Parent folder IDs
};

export type StorageQuota = {
  usage: number;          // bytes used
  limit: number;          // total bytes available
  usageInDrive: number;   // bytes used in Drive
  usageInTrash: number;   // bytes used in trash
};

export type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime: string;
  createdTime: string;
  trashed: boolean;
  parents?: string[];
  webViewLink?: string;
  iconLink?: string;
  isFolder: boolean;
  sharedWithMe?: boolean;
  shared?: boolean; // Add direct shared property from API
};

export type UserPreferences = {
  defaultFolderId?: string;
  defaultFolderName?: string;
  filenamePattern: string;
  theme: 'system' | 'light' | 'dark';
  colorScheme?: 'default' | 'cool' | 'warm' | 'crimson' | 'morandi' | 'ocean' | 'sunset' | 'forest' | 'emerald' | 'amber' | 'bronze' | 'berry' | 'indigo' | 'drive'; // Color scheme
  notificationsEnabled: boolean;
  useServerUpload?: boolean; // Use Cloud Run for URL uploads
  defaultAccountId?: string; // Default account for multi-account
};

export type DriveAccount = {
  id: string;
  email: string;
  name?: string;
  picture?: string; // Profile picture URL from Google
  tokens: TokenResponse;
  cloudRunUrl?: string; // Optional Cloud Run endpoint for this account
  cloudRunKey?: string; // Optional API key for Cloud Run
  githubOwner?: string; // Optional GitHub owner for this account
  githubRepo?: string;  // Optional GitHub repo for this account
  githubToken?: string; // Optional GitHub token for this account
  githubEnabled?: boolean; // Whether GitHub Actions is enabled for this account
  githubSecretKey?: string; // GitHub secret name for this account's refresh token (e.g., DRIVE_REFRESH_TOKEN_MAIN)
  appsScriptUrl?: string; // Google Apps Script Web App URL for remote uploads
  appsScriptEnabled?: boolean; // Whether Google Apps Script backend is enabled for this account
  appsScriptSizeLimit?: number; // Max file size in MB for Apps Script uploads (default: 50)
  createdAt: number;
  lastUsed?: number;
};

export type ServiceConfig = {
  cloudRunUrl: string;
  appKey: string;
  enabled: boolean;
};

export type GitHubConfig = {
  owner: string;              // GitHub username or org
  repo: string;               // Workflow repository name
  token: string;              // Fine-grained PAT
  defaultAccountKey: string;  // Default secret name (e.g., DRIVE_REFRESH_TOKEN_MAIN)
  defaultParentKey?: string;  // Optional default folder secret
  enabled: boolean;           // Enable/disable GitHub Actions backend
};

export type GitHubAccount = {
  id: string;                 // Unique ID for UI
  name: string;               // Display name
  email?: string;             // Account email
  secretKey: string;          // GitHub secret name
  folderKey?: string;         // Optional folder secret
};

export type MessageType =
  | 'AUTH_SIGN_IN'
  | 'AUTH_SIGN_OUT'
  | 'AUTH_STATE'
  | 'ENQUEUE_JOB'
  | 'CANCEL_JOB'
  | 'RETRY_JOB'
  | 'JOB_UPDATED'
  | 'GET_JOBS'
  | 'CLEAR_COMPLETED_JOBS'
  | 'CLEAR_HISTORY'
  | 'GET_PREFS'
  | 'UPDATE_PREFS'
  | 'PREFS_UPDATED'
  | 'LIST_FOLDERS'
  | 'CREATE_FOLDER'
  | 'PREFILL_URL'
  | 'GET_ACCOUNTS'
  | 'ADD_ACCOUNT'
  | 'REMOVE_ACCOUNT'
  | 'SWITCH_ACCOUNT'
  | 'UPDATE_ACCOUNTS'
  | 'GET_VALID_TOKEN'
  | 'UPDATE_SERVICE_CONFIG'
  | 'GET_SERVICE_CONFIG'
  | 'UPDATE_GITHUB_CONFIG'
  | 'GET_GITHUB_CONFIG'
  | 'GET_GITHUB_ACCOUNTS'
  | 'UPDATE_GITHUB_ACCOUNTS'
  | 'GET_STORAGE_QUOTA'
  | 'GET_SHARED_FOLDERS'
  | 'LIST_FOLDER_CONTENTS'
  | 'DELETE_ITEM'
  | 'RENAME_ITEM'
  | 'MOVE_ITEM'
  | 'EMPTY_TRASH'
  | 'EMPTY_TRASH_WITH_PROGRESS'
  | 'EMPTY_TRASH_PROGRESS_UPDATE'
  | 'LIST_TRASH'
  | 'LIST_SHARED_WITH_ME'
  | 'RESTORE_ITEM'
  | 'PERMANENTLY_DELETE_ITEM'
  | 'GET_FILE_DOWNLOAD_URL'
  | 'DOWNLOAD_FILE'
  | 'FETCH_FILE_CONTENT'
  | 'GET_DOWNLOAD_CHUNK'
  | 'CANCEL_DOWNLOAD'
  | 'PAUSE_DOWNLOAD'
  | 'SYNC_DOWNLOAD_STATUS'
  | 'DOWNLOAD_PROGRESS_UPDATE'
  | 'UPDATE_ACCOUNTS'
  | 'SEARCH_DRIVE'
  | 'COPY_FILE'
  | 'LIST_FOLDERS_FOR_ACCOUNT'
  | 'COPY_FILE_PROGRESS'
  | 'CANCEL_COPY';

export type Message = {
  type: MessageType;
  payload?: any;
};

export type ErrorInfo = {
  code: string;
  stage: 'download' | 'upload' | 'auth' | 'cors' | 'drive';
  message: string;
  retriable: boolean;
};

export interface Permission {
  id: string;
  type: 'user' | 'anyone' | 'group' | 'domain';
  role: 'owner' | 'reader' | 'writer' | 'commenter';
  emailAddress?: string;
  displayName?: string;
  photoLink?: string;
  deleted?: boolean;
}
