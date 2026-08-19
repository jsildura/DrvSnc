// Google Drive API utilities
import type { DriveFolder, Permission } from './types';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

/**
 * Get all shared items (files and folders) in the user's Drive
 * This includes items shared by the user and with the user
 */
/**
 * Gets shared folders using the optimal API approach.
 * This follows the approach from the SharedFolderDetector component which directly
 * queries only for folders that are explicitly shared with the user.
 */
export async function getAllSharedItems(token: string): Promise<{ id: string; name: string; isFolder: boolean; shared: boolean }[]> {
  try {
    // Create URL for the Drive API endpoint
    const url = new URL(`${DRIVE_API_BASE}/files`);
    
    // Query for all folders, not just ones shared with the user
    url.searchParams.set('q', "mimeType='application/vnd.google-apps.folder' and trashed=false");
    
    // Request the fields we need including 'shared' property
    url.searchParams.set('fields', 'files(id,name,mimeType,shared)');
    url.searchParams.set('pageSize', '1000');
    console.log('Querying for folders shared with the user');
    
    // Make the API request
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Handle specific error cases with meaningful messages
    if (response.status === 401) {
      console.error('Unauthorized (401). The token may be invalid or expired.');
      return [];
    }
    if (response.status === 403) {
      console.error('Forbidden (403). Please ensure the Google Drive API is enabled and has correct scopes.');
      return [];
    }
    if (!response.ok) {
      console.error(`Failed to get shared items: ${response.status}`);
      return [];
    }

    // Process the response
    const data = await response.json();
    if (!data.files || !Array.isArray(data.files)) {
      return [];
    }

    // Process all folders and just track the 'shared' property from the API
    const folders = data.files;
    
    // Log shared folders for debugging
    folders.forEach((folder: any) => {
      if (folder.shared === true) {
        console.log(`API reports folder as shared: ${folder.name} (${folder.id})`);
      }
    });

    // Transform to our required format
    const sharedFolders = folders.map((folder: any) => ({
      id: folder.id || '',
      name: folder.name || '',
      isFolder: true, // All items are folders based on our query
      shared: folder.shared || false
    }));
    
    // Log the results
    sharedFolders.forEach((folder: {id: string, name: string, isFolder: boolean, shared: boolean}) => {
      console.log(`Found folder: ${folder.name} (${folder.id}) - Shared: ${folder.shared}`);
    });
    console.log(`Found ${sharedFolders.length} folders`);
    
    // Return the shared folders
    return sharedFolders;
  } catch (error) {
    console.error('Error fetching shared items:', error);
    return [];
  }
}

/**
 * Get items shared with me (owned by others)
 * Returns files and folders with owner information and shared date
 */
export async function getSharedWithMeItems(token: string) {
  try {
    const url = new URL(`${DRIVE_API_BASE}/files`);
    
    // Query for items shared with me (not owned by me)
    url.searchParams.set('q', "sharedWithMe=true and trashed=false");
    
    // Request comprehensive fields including owner info and shared date
    url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,createdTime,size,iconLink,shared,sharedWithMeTime,owners,sharingUser,viewedByMeTime,modifiedByMeTime)');
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('orderBy', 'sharedWithMeTime desc');
    
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to get shared with me items: ${response.status}`);
    }

    const data = await response.json();
    return data.files || [];
  } catch (error) {
    console.error('Error fetching shared with me items:', error);
    return [];
  }
}

export async function listFolders(token: string): Promise<DriveFolder[]> {
  const url = new URL(`${DRIVE_API_BASE}/files`);
  // Only get folders owned by the user (excludes shared folders from others)
  url.searchParams.set('q', "mimeType='application/vnd.google-apps.folder' and trashed=false and 'me' in owners");
  url.searchParams.set('fields', 'files(id, name, parents)');
  url.searchParams.set('pageSize', '1000');
  url.searchParams.set('orderBy', 'name');

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to list folders: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.files || [];
}

export async function createFolder(token: string, name: string, parentId?: string): Promise<DriveFolder> {
  const metadata: any = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };

  if (parentId) {
    metadata.parents = [parentId];
  }

  const response = await fetch(`${DRIVE_API_BASE}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });

  if (!response.ok) {
    throw new Error(`Failed to create folder: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return { id: data.id, name: data.name };
}

export async function uploadSmallFile(
  token: string,
  filename: string,
  folderId: string,
  blob: Blob,
  mimeType?: string,
  signal?: AbortSignal
): Promise<{ id: string; webViewLink: string }> {
  const metadata = {
    name: filename,
    parents: [folderId],
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadataPart = delimiter + 'Content-Type: application/json\r\n\r\n' + JSON.stringify(metadata);

  const filePart =
    delimiter + `Content-Type: ${mimeType || blob.type || 'application/octet-stream'}\r\n\r\n`;

  const blobParts = [
    new Blob([metadataPart], { type: 'text/plain' }),
    new Blob([filePart], { type: 'text/plain' }),
    blob,
    new Blob([closeDelimiter], { type: 'text/plain' }),
  ];

  const multipartBody = new Blob(blobParts, { type: `multipart/related; boundary=${boundary}` });

  const response = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed: ${response.status} ${text}`);
  }

  return await response.json();
}

export async function initiateResumableUpload(
  token: string,
  filename: string,
  folderId: string,
  mimeType?: string,
  signal?: AbortSignal
): Promise<string> {
  const metadata = {
    name: filename,
    parents: [folderId],
    mimeType: mimeType || 'application/octet-stream',
  };

  const response = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=resumable&fields=id,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(metadata),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to initiate resumable upload: ${response.status} ${text}`);
  }

  const sessionUrl = response.headers.get('Location');
  if (!sessionUrl) {
    throw new Error('No session URL returned');
  }

  return sessionUrl;
}

export async function uploadChunk(
  sessionUrl: string,
  chunk: Uint8Array,
  start: number,
  total: number | undefined,
  token: string,
  signal?: AbortSignal
): Promise<{ done: boolean; fileId?: string; webViewLink?: string }> {
  const end = start + chunk.length - 1;
  const sizeHeader = total !== undefined ? String(total) : '*';

  const response = await fetch(sessionUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Length': String(chunk.length),
      'Content-Range': `bytes ${start}-${end}/${sizeHeader}`,
    },
    body: chunk.buffer as ArrayBuffer,
    signal,
  });

  if (response.status === 308) {
    // Resume Incomplete
    return { done: false };
  }

  if (response.status === 200 || response.status === 201) {
    const data = await response.json();
    return { done: true, fileId: data.id, webViewLink: data.webViewLink };
  }

  const text = await response.text();
  throw new Error(`Chunk upload failed: ${response.status} ${text}`);
}

/**
 * Fetches all permissions for a given file.
 */
export async function getFilePermissions(token: string, fileId: string): Promise<Permission[]> {
  const response = await fetch(
    `${DRIVE_API_BASE}/files/${fileId}/permissions?fields=permissions(id,type,emailAddress,role,displayName,photoLink,deleted)`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get permissions: ${response.status} ${text}`);
  }
  
  const data = await response.json();
  return data.permissions || [];
}

/**
 * Adds a new permission to a file (invite a person by email).
 */
export async function addPermission(
  token: string,
  fileId: string,
  email: string,
  role: 'reader' | 'commenter' | 'writer'
): Promise<Permission> {
  const response = await fetch(
    `${DRIVE_API_BASE}/files/${fileId}/permissions?sendNotificationEmail=false&fields=id,type,emailAddress,role,displayName,photoLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        type: 'user', 
        role, 
        emailAddress: email 
      }),
    }
  );
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to add permission: ${response.status} ${text}`);
  }
  
  return await response.json();
}

/**
 * Updates an existing permission's role.
 */
export async function updatePermission(
  token: string,
  fileId: string,
  permissionId: string,
  role: 'reader' | 'commenter' | 'writer'
): Promise<Permission> {
  const response = await fetch(
    `${DRIVE_API_BASE}/files/${fileId}/permissions/${permissionId}?fields=id,type,emailAddress,role,displayName,photoLink`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role }),
    }
  );
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to update permission: ${response.status} ${text}`);
  }
  
  return await response.json();
}

/**
 * Removes a permission from a file.
 */
export async function removePermission(
  token: string,
  fileId: string,
  permissionId: string
): Promise<void> {
  const response = await fetch(
    `${DRIVE_API_BASE}/files/${fileId}/permissions/${permissionId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to remove permission: ${response.status} ${text}`);
  }
}

/**
 * Sets public access for a file (Anyone with the link).
 * Returns the permission object created.
 */
export async function setPublicAccess(
  token: string,
  fileId: string,
  role: 'reader' | 'commenter' | 'writer' = 'reader'
): Promise<Permission> {
  const response = await fetch(
    `${DRIVE_API_BASE}/files/${fileId}/permissions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        type: 'anyone', 
        role 
      }),
    }
  );
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to set public access: ${response.status} ${text}`);
  }
  
  return await response.json();
}

/**
 * Get file metadata including name, mimeType, size, and parent folders
 */
export async function getFileMetadata(token: string, fileId: string): Promise<any> {
  const url = new URL(`${DRIVE_API_BASE}/files/${fileId}`);
  url.searchParams.set('fields', 'id,name,mimeType,size,parents');

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to get file metadata: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Download file content as a Blob
 */
export async function downloadFileContent(token: string, fileId: string): Promise<Blob> {
  const url = new URL(`${DRIVE_API_BASE}/files/${fileId}`);
  url.searchParams.set('alt', 'media');

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  return await response.blob();
}

/**
 * Copy a file from one account to another
 */
export async function copyFileBetweenAccounts(
  sourceToken: string,
  destinationToken: string,
  fileId: string,
  destinationFolderId: string,
  onProgress?: (bytesTransferred: number, totalBytes: number) => void,
  signal?: AbortSignal
): Promise<{ id: string; webViewLink: string }> {
  // 1. Get file metadata from source account
  const metadata = await getFileMetadata(sourceToken, fileId);
  const { name, mimeType, size } = metadata;

  // 2. Download file from source account (this happens quickly, no progress needed)
  const fileBlob = await downloadFileContent(sourceToken, fileId);

  // 3. Upload file to destination account (this is where we track progress)
  // For files larger than 5MB, use resumable upload
  const fileSizeInBytes = fileBlob.size;
  const FIVE_MB = 5 * 1024 * 1024;

  if (fileSizeInBytes > FIVE_MB) {
    // Use resumable upload for large files
    const sessionUrl = await initiateResumableUpload(
      destinationToken,
      name,
      destinationFolderId,
      mimeType,
      signal
    );

    // Upload in chunks
    const CHUNK_SIZE = 256 * 1024; // 256KB chunks
    const arrayBuffer = await fileBlob.arrayBuffer();
    const totalBytes = arrayBuffer.byteLength;
    let uploaded = 0;
    
    // Report initial progress to transition from "Preparing..." state
    if (onProgress) {
      onProgress(0, totalBytes);
    }

    while (uploaded < totalBytes) {
      // Check if aborted before each chunk
      if (signal?.aborted) {
        throw new Error('Copy operation cancelled by user');
      }
      
      const chunk = new Uint8Array(
        arrayBuffer.slice(uploaded, Math.min(uploaded + CHUNK_SIZE, totalBytes))
      );

      const result = await uploadChunk(
        sessionUrl,
        chunk,
        uploaded,
        totalBytes,
        destinationToken,
        signal
      );

      uploaded += chunk.length;
      
      // Report progress
      if (onProgress) {
        onProgress(uploaded, totalBytes);
      }

      if (result.done && result.fileId && result.webViewLink) {
        return { id: result.fileId, webViewLink: result.webViewLink };
      }
    }

    throw new Error('Upload completed but no file ID returned');
  } else {
    // Use simple upload for small files
    // Report progress start
    if (onProgress) {
      onProgress(0, fileSizeInBytes);
    }
    
    const result = await uploadSmallFile(
      destinationToken,
      name,
      destinationFolderId,
      fileBlob,
      mimeType
    );
    
    // Report completion
    if (onProgress) {
      onProgress(fileSizeInBytes, fileSizeInBytes);
    }
    
    return result;
  }
}
