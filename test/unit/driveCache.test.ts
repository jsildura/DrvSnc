import { describe, it, expect, beforeEach, vi } from 'vitest';
import { driveCache, DriveCacheEntry } from '../../src/web/services/driveCache';
import { DriveItemView } from '../../src/shared/contracts';

const sampleItem1: DriveItemView = {
  id: 'folder-1',
  name: 'Work Documents',
  mimeType: 'application/vnd.google-apps.folder',
  isFolder: true,
  shared: false,
  trashed: false,
};

const sampleItem2: DriveItemView = {
  id: 'file-2',
  name: 'Budget.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  isFolder: false,
  shared: false,
  trashed: false,
  size: 2048,
};

describe('Drive Client-Side Caching (driveCache)', () => {
  beforeEach(() => {
    driveCache.invalidateAll();
    driveCache.setFreshTtl(30 * 1000);
    driveCache.setMaxAge(5 * 60 * 1000);
  });

  it('returns miss for non-cached folder', () => {
    const result = driveCache.getCachedFolder('files', 'folder-999');
    expect(result.status).toBe('miss');
    expect(result.data).toBeNull();
  });

  it('serves fresh data with zero latency within fresh TTL', () => {
    driveCache.setCachedFolder('files', 'folder-1', undefined, {
      items: [sampleItem1, sampleItem2],
      nextPageToken: 'token-abc',
    });

    const result = driveCache.getCachedFolder('files', 'folder-1');
    expect(result.status).toBe('fresh');
    expect(result.data?.items).toHaveLength(2);
    expect(result.data?.items[0].name).toBe('Work Documents');
    expect(result.data?.nextPageToken).toBe('token-abc');
  });

  it('serves stale data when between fresh TTL and max age (SWR trigger)', () => {
    driveCache.setFreshTtl(100); // 100ms
    driveCache.setMaxAge(5000); // 5s

    driveCache.setCachedFolder('files', 'folder-1', undefined, {
      items: [sampleItem1],
      nextPageToken: null,
    });

    // Advance time past fresh TTL (150ms) but within max age
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 200);

    const result = driveCache.getCachedFolder('files', 'folder-1');
    expect(result.status).toBe('stale');
    expect(result.data?.items).toHaveLength(1);
  });

  it('expires entries older than max age', () => {
    driveCache.setMaxAge(1000); // 1s

    driveCache.setCachedFolder('files', 'folder-1', undefined, {
      items: [sampleItem1],
      nextPageToken: null,
    });

    // Advance time past max age (1500ms)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1500);

    const result = driveCache.getCachedFolder('files', 'folder-1');
    expect(result.status).toBe('miss');
    expect(result.data).toBeNull();
  });

  it('bypasses cache when search query is active', () => {
    driveCache.setCachedFolder('files', 'root', undefined, {
      items: [sampleItem1],
      nextPageToken: null,
    });

    const result = driveCache.getCachedFolder('files', 'root', 'search-term');
    expect(result.status).toBe('miss');
    expect(result.data).toBeNull();
  });

  it('appends paginated items and deduplicates them in cached snapshot', () => {
    driveCache.setCachedFolder('files', 'root', undefined, {
      items: [sampleItem1],
      nextPageToken: 'page-2-token',
    });

    driveCache.appendCachedItems('files', 'root', undefined, [sampleItem2], 'page-3-token');

    const result = driveCache.getCachedFolder('files', 'root');
    expect(result.status).toBe('fresh');
    expect(result.data?.items).toHaveLength(2);
    expect(result.data?.nextPageToken).toBe('page-3-token');
  });

  it('invalidates a specific folder without affecting other folders', () => {
    driveCache.setCachedFolder('files', 'folder-1', undefined, { items: [sampleItem1], nextPageToken: null });
    driveCache.setCachedFolder('files', 'folder-2', undefined, { items: [sampleItem2], nextPageToken: null });

    driveCache.invalidateFolder('files', 'folder-1');

    expect(driveCache.getCachedFolder('files', 'folder-1').status).toBe('miss');
    expect(driveCache.getCachedFolder('files', 'folder-2').status).toBe('fresh');
  });

  it('removes an item across cached folders on trash/delete', () => {
    driveCache.setCachedFolder('files', 'folder-1', undefined, {
      items: [sampleItem1, sampleItem2],
      nextPageToken: null,
    });

    driveCache.removeCachedItem('file-2');

    const result = driveCache.getCachedFolder('files', 'folder-1');
    expect(result.data?.items).toHaveLength(1);
    expect(result.data?.items[0].id).toBe('folder-1');
  });

  it('updates an item in place across cached folders on rename', () => {
    driveCache.setCachedFolder('files', 'folder-1', undefined, {
      items: [sampleItem2],
      nextPageToken: null,
    });

    const updatedItem = { ...sampleItem2, name: 'Renamed_Budget_2026.xlsx' };
    driveCache.updateCachedItem(updatedItem);

    const result = driveCache.getCachedFolder('files', 'folder-1');
    expect(result.data?.items[0].name).toBe('Renamed_Budget_2026.xlsx');
  });

  it('enforces maximum cache size using LRU eviction', () => {
    for (let i = 0; i < 55; i++) {
      driveCache.setCachedFolder('files', `folder-${i}`, undefined, {
        items: [sampleItem1],
        nextPageToken: null,
      });
    }

    expect(driveCache.size()).toBeLessThanOrEqual(50);
    // Oldest folders (folder-0 to folder-4) should have been evicted
    expect(driveCache.getCachedFolder('files', 'folder-0').status).toBe('miss');
    // Newest folders should still be present
    expect(driveCache.getCachedFolder('files', 'folder-54').status).toBe('fresh');
  });
});
