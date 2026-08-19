import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  listRememberedAccounts,
  rememberAccount,
  forgetRememberedAccount,
  clearRememberedAccounts,
  getLoginUrlWithHint,
} from '../../src/web/auth/rememberedAccounts';

class MockStorage {
  private store: Map<string, string> = new Map();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

describe('Remembered Account Login Hints (Client-Side Storage)', () => {
  beforeAll(() => {
    (globalThis as unknown as { localStorage: MockStorage }).localStorage = new MockStorage();
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it('returns empty array when no accounts are remembered', () => {
    expect(listRememberedAccounts()).toEqual([]);
  });

  it('recovers gracefully from corrupted JSON in localStorage', () => {
    localStorage.setItem('gdu_remembered_accounts', '{ invalid json [');
    expect(listRememberedAccounts()).toEqual([]);
  });

  it('remembers an account and strips forbidden/token fields', () => {
    const maliciousPayload = {
      sub: 'sub-1',
      email: 'user1@example.com',
      name: 'User One',
      picture: 'https://lh3.googleusercontent.com/photo.jpg',
      token: 'secret_token_leaked',
      session_id: 'sess-123',
      password: 'mypassword',
    };

    const list = rememberAccount(maliciousPayload as unknown as { sub: string; email: string });
    expect(list).toHaveLength(1);
    expect(list[0].email).toBe('user1@example.com');
    expect(list[0].sub).toBe('sub-1');
    const firstAcc = list[0] as unknown as Record<string, unknown>;
    expect(firstAcc.token).toBeUndefined();
    expect(firstAcc.session_id).toBeUndefined();
    expect(firstAcc.password).toBeUndefined();

    // Verify stored in localStorage cleanly
    const raw = JSON.parse(localStorage.getItem('gdu_remembered_accounts') || '[]');
    expect(raw[0].token).toBeUndefined();
  });

  it('deduplicates by sub and updates lastUsedAt with newest first', () => {
    rememberAccount({ sub: 'sub-1', email: 'user1@example.com', name: 'User One' });
    rememberAccount({ sub: 'sub-2', email: 'user2@example.com', name: 'User Two' });
    // Update sub-1 again
    const updated = rememberAccount({ sub: 'sub-1', email: 'user1-new@example.com', name: 'User One Updated' });

    expect(updated).toHaveLength(2);
    expect(updated[0].sub).toBe('sub-1');
    expect(updated[0].name).toBe('User One Updated');
    expect(updated[1].sub).toBe('sub-2');
  });

  it('enforces maximum 5 accounts eviction policy', () => {
    for (let i = 1; i <= 7; i++) {
      rememberAccount({ sub: `sub-${i}`, email: `user${i}@example.com`, name: `User ${i}` });
    }

    const list = listRememberedAccounts();
    expect(list).toHaveLength(5);
    expect(list[0].sub).toBe('sub-7');
    expect(list[4].sub).toBe('sub-3');
  });

  it('forgets individual account and clears all accounts', () => {
    rememberAccount({ sub: 'sub-1', email: 'user1@example.com' });
    rememberAccount({ sub: 'sub-2', email: 'user2@example.com' });

    forgetRememberedAccount('sub-1');
    expect(listRememberedAccounts()).toHaveLength(1);
    expect(listRememberedAccounts()[0].sub).toBe('sub-2');

    clearRememberedAccounts();
    expect(listRememberedAccounts()).toHaveLength(0);
  });

  it('generates login start URL with encoded email hint', () => {
    const acc = {
      sub: 'sub-1',
      email: 'user+test@example.com',
      lastUsedAt: new Date().toISOString(),
    };
    const url = getLoginUrlWithHint(acc);
    expect(url).toBe('/api/v1/auth/google/start?login_hint=user%2Btest%40example.com');
  });
});
