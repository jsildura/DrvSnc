// IndexedDB storage for temporary file data during upload
// This avoids chrome.runtime.sendMessage size limits

const DB_NAME = 'GDriveUploaderFiles';
const DB_VERSION = 1;
const STORE_NAME = 'tempFiles';

interface StoredFile {
  id: string;
  blob: Blob;
  timestamp: number;
  size: number;
  lastAccessed: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  }
  return dbPromise;
}

/**
 * Store a file temporarily and return its ID
 * Enforces 500MB storage limit with LRU eviction
 */
export async function storeFile(blob: Blob): Promise<string> {
  const db = await openDB();
  const id = crypto.randomUUID();
  const now = Date.now();
  const storedFile: StoredFile = {
    id,
    blob,
    timestamp: now,
    size: blob.size,
    lastAccessed: now,
  };

  // Enforce storage limit before adding new file
  await enforceStorageLimit(blob.size);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(storedFile);

    request.onsuccess = () => resolve(id);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieve a stored file by ID and update last accessed time
 */
export async function retrieveFile(id: string): Promise<Blob | null> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      const storedFile = request.result as StoredFile | undefined;
      if (storedFile) {
        // Update last accessed time for LRU
        storedFile.lastAccessed = Date.now();
        store.put(storedFile);
        resolve(storedFile.blob);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a stored file by ID
 */
export async function deleteFile(id: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clean up files older than 7 days (more generous than 1 hour)
 */
export async function cleanupOldFiles(): Promise<void> {
  const db = await openDB();
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let deletedCount = 0;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openCursor();

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const storedFile = cursor.value as StoredFile;
        if (storedFile.timestamp < sevenDaysAgo) {
          cursor.delete();
          deletedCount++;
        }
        cursor.continue();
      } else {
        if (deletedCount > 0) {
          console.log(`[IndexedDB] Cleaned up ${deletedCount} old files`);
        }
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all stored files (for management)
 */
export async function getAllStoredFiles(): Promise<StoredFile[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as StoredFile[]);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Enforce 500MB storage limit with LRU eviction
 */
export async function enforceStorageLimit(newFileSize: number = 0): Promise<void> {
  const db = await openDB();
  const MAX_STORAGE = 500 * 1024 * 1024; // 500MB
  
  const files = await getAllStoredFiles();
  
  // Calculate current total size
  let totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
  
  // If adding new file would exceed limit, remove oldest files
  if (totalSize + newFileSize > MAX_STORAGE) {
    // Sort by last accessed (LRU - least recently used first)
    files.sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));
    
    let deletedCount = 0;
    for (const file of files) {
      if (totalSize + newFileSize <= MAX_STORAGE) break;
      
      await deleteFile(file.id);
      totalSize -= (file.size || 0);
      deletedCount++;
    }
    
    if (deletedCount > 0) {
      console.log(`[IndexedDB] Evicted ${deletedCount} files to stay within 500MB limit`);
    }
  }
}

/**
 * Get storage statistics
 */
export async function getStorageStats(): Promise<{ count: number; totalSize: number }> {
  const files = await getAllStoredFiles();
  return {
    count: files.length,
    totalSize: files.reduce((sum, f) => sum + (f.size || 0), 0),
  };
}
