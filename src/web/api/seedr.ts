import { apiRequest } from './client';

export interface SeedrStatusResponse {
  connected: boolean;
  username?: string;
  spaceUsed?: number;
  spaceMax?: number;
  torrents?: Array<{
    id: number | string;
    name: string;
    progress: number;
    size: number;
    status: string;
  }>;
}

export interface SeedrDeviceCodeData {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
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

export async function getSeedrDeviceCode(): Promise<SeedrDeviceCodeData> {
  return apiRequest<SeedrDeviceCodeData>('/api/v1/seedr/device/code', {
    method: 'POST',
  });
}

export async function authorizeSeedrDevice(
  deviceCode: string
): Promise<{ success: boolean; response?: string }> {
  return apiRequest<{ success: boolean; response?: string }>(
    '/api/v1/seedr/device/authorize',
    {
      method: 'POST',
      body: JSON.stringify({ deviceCode }),
    }
  );
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
