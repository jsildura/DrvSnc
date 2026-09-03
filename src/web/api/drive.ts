import {
  DriveItemView,
  DrivePage,
  QuotaView,
  PermissionView,
} from '../../shared/contracts';
import { apiRequest } from './client';

export async function getDriveStorage(): Promise<QuotaView> {
  return apiRequest<QuotaView>('/api/v1/drive/quota');
}

export async function listDriveItems(options?: {
  parentId?: string;
  query?: string;
  pageToken?: string;
  pageSize?: number;
  orderBy?: string;
}): Promise<DrivePage> {
  const params = new URLSearchParams();
  if (options?.parentId) params.set('parentId', options.parentId);
  if (options?.query) params.set('query', options.query);
  if (options?.pageToken) params.set('pageToken', options.pageToken);
  if (options?.pageSize) params.set('pageSize', String(options.pageSize));
  if (options?.orderBy) params.set('orderBy', options.orderBy);

  const queryStr = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<DrivePage>(`/api/v1/drive/items${queryStr}`);
}

export async function listSharedItems(options?: {
  pageToken?: string;
  pageSize?: number;
}): Promise<DrivePage> {
  const params = new URLSearchParams();
  if (options?.pageToken) params.set('pageToken', options.pageToken);
  if (options?.pageSize) params.set('pageSize', String(options.pageSize));

  const queryStr = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<DrivePage>(`/api/v1/drive/shared${queryStr}`);
}

export async function listTrashItems(options?: {
  pageToken?: string;
  pageSize?: number;
}): Promise<DrivePage> {
  const params = new URLSearchParams();
  if (options?.pageToken) params.set('pageToken', options.pageToken);
  if (options?.pageSize) params.set('pageSize', String(options.pageSize));

  const queryStr = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<DrivePage>(`/api/v1/drive/trash${queryStr}`);
}

export async function listDriveFolders(options?: {
  parentId?: string;
  pageToken?: string;
  pageSize?: number;
}): Promise<DrivePage> {
  const params = new URLSearchParams();
  if (options?.parentId) params.set('parentId', options.parentId);
  if (options?.pageToken) params.set('pageToken', options.pageToken);
  if (options?.pageSize) params.set('pageSize', String(options.pageSize));

  const queryStr = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<DrivePage>(`/api/v1/drive/folders${queryStr}`);
}

export async function createFolder(name: string, parentId?: string): Promise<DriveItemView> {
  return apiRequest<DriveItemView>('/api/v1/drive/folders', {
    method: 'POST',
    body: JSON.stringify({ name, parentFolderId: parentId }),
  });
}

export async function renameItem(fileId: string, name: string): Promise<DriveItemView> {
  return apiRequest<DriveItemView>(`/api/v1/drive/items/${encodeURIComponent(fileId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function moveItem(
  fileId: string,
  addParents: string[],
  removeParents: string[]
): Promise<DriveItemView> {
  return apiRequest<DriveItemView>(`/api/v1/drive/items/${encodeURIComponent(fileId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ addParents, removeParents }),
  });
}

export async function trashItem(fileId: string): Promise<DriveItemView> {
  return apiRequest<DriveItemView>(`/api/v1/drive/items/${encodeURIComponent(fileId)}/trash`, {
    method: 'POST',
  });
}

export async function restoreItem(fileId: string): Promise<DriveItemView> {
  return apiRequest<DriveItemView>(`/api/v1/drive/items/${encodeURIComponent(fileId)}/restore`, {
    method: 'POST',
  });
}

export async function deleteItemPermanently(fileId: string): Promise<void> {
  await apiRequest(`/api/v1/drive/items/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
  });
}

export async function emptyTrash(): Promise<void> {
  await apiRequest('/api/v1/drive/trash/empty', {
    method: 'POST',
  });
}

export async function getPermissions(fileId: string): Promise<PermissionView[]> {
  return apiRequest<PermissionView[]>(`/api/v1/drive/files/${encodeURIComponent(fileId)}/permissions`);
}

export async function addPermission(
  fileId: string,
  role: string,
  type: string,
  emailAddress?: string
): Promise<PermissionView> {
  return apiRequest<PermissionView>(`/api/v1/drive/files/${encodeURIComponent(fileId)}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ role, type, emailAddress }),
  });
}

export async function removePermission(fileId: string, permissionId: string): Promise<void> {
  await apiRequest(
    `/api/v1/drive/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`,
    {
      method: 'DELETE',
    }
  );
}

export function getDownloadUrl(fileId: string, exportMimeType?: string): string {
  const base = `/api/v1/drive/files/${encodeURIComponent(fileId)}/download`;
  return exportMimeType ? `${base}?exportMimeType=${encodeURIComponent(exportMimeType)}` : base;
}

export async function searchDriveItems(
  query: string,
  options?: { pageToken?: string; pageSize?: number }
): Promise<DrivePage> {
  const params = new URLSearchParams();
  params.set('q', query);
  if (options?.pageToken) params.set('pageToken', options.pageToken);
  if (options?.pageSize) params.set('pageSize', String(options.pageSize));
  return apiRequest<DrivePage>(`/api/v1/drive/search?${params.toString()}`);
}
