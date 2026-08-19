import { apiRequest } from './client';

export interface SeedrItemView {
  id: string | number;
  name: string;
  size: number;
}

export interface SeedrTorrentItemView {
  id: string | number;
  name: string;
  progress: number;
  size: number;
  status: string;
}

export interface SeedrStatusResponse {
  connected: boolean;
  username?: string;
  email?: string;
  isPremium?: boolean;
  packageName?: string;
  spaceUsed?: number;
  spaceMax?: number;
  torrents?: SeedrTorrentItemView[];
  folders?: SeedrItemView[];
  files?: SeedrItemView[];
}

export interface SeedrTransferResponse {
  success: boolean;
  status: 'transferring' | 'downloading';
  jobId?: string;
  userTorrentId?: number | string;
  title?: string;
  message?: string;
  error?: string;
}

export async function getSeedrStatus(): Promise<SeedrStatusResponse> {
  return apiRequest<SeedrStatusResponse>('/api/v1/seedr/status');
}

export async function disconnectSeedr(): Promise<void> {
  await apiRequest<{ success: boolean }>('/api/v1/seedr/disconnect', {
    method: 'DELETE',
  });
}

export async function loginSeedrAccount(
  username: string,
  password: string
): Promise<{ success: boolean; username?: string }> {
  return apiRequest<{ success: boolean; username?: string }>('/api/v1/seedr/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function submitSeedrTransfer(params: {
  magnetLink: string;
  folderId?: string;
  filename?: string;
}): Promise<SeedrTransferResponse> {
  return apiRequest<SeedrTransferResponse>('/api/v1/seedr/transfer', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function transferSeedrItem(params: {
  itemType: 'folder' | 'file';
  itemId: string | number;
  itemName?: string;
  folderId?: string;
  filename?: string;
}): Promise<SeedrTransferResponse> {
  return apiRequest<SeedrTransferResponse>('/api/v1/seedr/transfer-item', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function deleteSeedrCloudItem(params: {
  itemType: 'torrent' | 'folder' | 'file';
  itemId: string | number;
}): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>('/api/v1/seedr/item', {
    method: 'DELETE',
    body: JSON.stringify(params),
  });
}
