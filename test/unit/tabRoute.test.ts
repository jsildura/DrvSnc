import { describe, it, expect } from 'vitest';
import { AppTab, LOGIN_PATH, TAB_PATHS, pathForTab, tabForPath } from '../../src/web/state/tabRoute';

describe('tabRoute path <-> tab mapping', () => {
  const tabs: AppTab[] = ['uploader', 'drive', 'converter', 'settings'];

  it('maps each tab to its canonical path', () => {
    expect(pathForTab('uploader')).toBe('/uploads');
    expect(pathForTab('drive')).toBe('/drive');
    expect(pathForTab('converter')).toBe('/converter');
    expect(pathForTab('settings')).toBe('/settings');
  });

  it('round-trips every tab through its path', () => {
    for (const tab of tabs) {
      expect(tabForPath(pathForTab(tab))).toBe(tab);
    }
  });

  it('normalises trailing slashes and casing', () => {
    expect(tabForPath('/drive/')).toBe('drive');
    expect(tabForPath('/drive///')).toBe('drive');
    expect(tabForPath('/Drive')).toBe('drive');
    expect(tabForPath('/SETTINGS/')).toBe('settings');
  });

  it('accepts /uploader as an alias for /uploads', () => {
    // The tab id is `uploader` while the path is `/uploads`; accept both rather
    // than silently falling back.
    expect(tabForPath('/uploader')).toBe('uploader');
    expect(tabForPath('/uploads')).toBe('uploader');
  });

  it('falls back to the uploader for the root, the login path and unknown paths', () => {
    expect(tabForPath('/')).toBe('uploader');
    expect(tabForPath(LOGIN_PATH)).toBe('uploader');
    expect(tabForPath('/nope')).toBe('uploader');
    expect(tabForPath('')).toBe('uploader');
  });

  it('exposes a canonical path for every declared tab', () => {
    expect(Object.keys(TAB_PATHS).sort()).toEqual([...tabs].sort());
    for (const path of Object.values(TAB_PATHS)) {
      expect(path.startsWith('/')).toBe(true);
    }
  });
});
