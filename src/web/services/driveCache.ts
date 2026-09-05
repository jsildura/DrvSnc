import { DriveItemView, DrivePage } from '../../shared/contracts';

export interface DriveCacheEntry {
  items: DriveItemView[];
  nextPageToken: string | null;
  fetchedAt: number;
}

export type CacheHitStatus = 'fresh' | 'stale' | 'miss';

export interface CacheLookupResult {
  data: DrivePage | null;
  status: CacheHitStatus;
}

// 30 seconds: fully fresh, zero network call needed
export const DEFAULT_FRESH_TTL_MS = 30 * 1000;
// 5 minutes: serve immediately (0ms) and revalidate in the background
export const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;
export const MAX_CACHE_ENTRIES = 50;
const SESSION_STORAGE_KEY = 'gdu_drive_folder_cache_v1';

class DriveCacheManager {
  private cache = new Map<string, DriveCacheEntry>();
  private freshTtlMs = DEFAULT_FRESH_TTL_MS;
  private maxAgeMs = DEFAULT_MAX_AGE_MS;

  constructor() {
    this.hydrateFromSession();
  }

  public getCacheKey(section: string, folderId?: string, query?: string): string {
    const q = query ? query.trim().toLowerCase() : '';
    return `${section}:${folderId || 'root'}:${q}`;
  }

  public getCachedFolder(
    section: string,
    folderId?: string,
    query?: string,
    freshTtlMs: number = this.freshTtlMs
  ): CacheLookupResult {
    // Avoid caching search queries by default to ensure real-time query accuracy
    if (query && query.trim()) {
      return { data: null, status: 'miss' };
    }

    const key = this.getCacheKey(section, folderId, query);
    const entry = this.cache.get(key);

    if (!entry) {
      return { data: null, status: 'miss' };
    }

    const age = Date.now() - entry.fetchedAt;

    // Older than max age: expired
    if (age > this.maxAgeMs) {
      this.cache.delete(key);
      this.persistToSession();
      return { data: null, status: 'miss' };
    }

    // Refresh LRU order on access
    this.cache.delete(key);
    this.cache.set(key, entry);

    const data: DrivePage = {
      items: entry.items,
      nextPageToken: entry.nextPageToken,
    };

    if (age <= freshTtlMs) {
      return { data, status: 'fresh' };
    }

    return { data, status: 'stale' };
  }

  public setCachedFolder(
    section: string,
    folderId?: string,
    query?: string,
    data?: DrivePage | null
  ): void {
    if (!data || (query && query.trim())) return;

    const key = this.getCacheKey(section, folderId, query);

    // Evict oldest entry if at capacity
    if (this.cache.size >= MAX_CACHE_ENTRIES && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      items: [...data.items],
      nextPageToken: data.nextPageToken || null,
      fetchedAt: Date.now(),
    });

    this.persistToSession();
  }

  /**
   * Append newly loaded paginated items to the cached folder snapshot.
   */
  public appendCachedItems(
    section: string,
    folderId?: string,
    query?: string,
    newItems?: DriveItemView[],
    nextPageToken?: string | null
  ): void {
    if (!newItems || newItems.length === 0 || (query && query.trim())) return;

    const key = this.getCacheKey(section, folderId, query);
    const entry = this.cache.get(key);
    if (!entry) return;

    const existingIds = new Set(entry.items.map((i) => i.id));
    const dedupedNew = newItems.filter((i) => !existingIds.has(i.id));

    this.cache.set(key, {
      items: [...entry.items, ...dedupedNew],
      nextPageToken: nextPageToken || null,
      fetchedAt: Date.now(),
    });

    this.persistToSession();
  }

  public invalidateFolder(section: string, folderId?: string, query?: string): void {
    const key = this.getCacheKey(section, folderId, query);
    this.cache.delete(key);
    this.persistToSession();
  }

  public invalidateAll(): void {
    this.cache.clear();
    this.persistToSession();
  }

  /**
   * Optimistically remove an item by ID from all cached folders.
   */
  public removeCachedItem(id: string): void {
    let changed = false;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.items.some((i) => i.id === id)) {
        this.cache.set(key, {
          ...entry,
          items: entry.items.filter((i) => i.id !== id),
        });
        changed = true;
      }
    }
    if (changed) this.persistToSession();
  }

  /**
   * Optimistically update an item in place across all cached folders.
   */
  public updateCachedItem(item: DriveItemView): void {
    let changed = false;
    for (const [key, entry] of this.cache.entries()) {
      const idx = entry.items.findIndex((i) => i.id === item.id);
      if (idx >= 0) {
        const updated = [...entry.items];
        updated[idx] = item;
        this.cache.set(key, {
          ...entry,
          items: updated,
        });
        changed = true;
      }
    }
    if (changed) this.persistToSession();
  }

  // Testing helpers
  public setFreshTtl(ms: number) {
    this.freshTtlMs = ms;
  }

  public setMaxAge(ms: number) {
    this.maxAgeMs = ms;
  }

  public size(): number {
    return this.cache.size;
  }

  private hydrateFromSession(): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const now = Date.now();
        for (const [k, v] of parsed) {
          if (
            typeof k === 'string' &&
            v &&
            typeof v === 'object' &&
            Array.isArray(v.items) &&
            typeof v.fetchedAt === 'number' &&
            now - v.fetchedAt < this.maxAgeMs
          ) {
            this.cache.set(k, v);
          }
        }
      }
    } catch {
      // sessionStorage unavailable or corrupted; start with clean in-memory cache
    }
  }

  private persistToSession(): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const entries = Array.from(this.cache.entries()).slice(-MAX_CACHE_ENTRIES);
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // ignore storage quota / sandbox issues
    }
  }
}

export const driveCache = new DriveCacheManager();
