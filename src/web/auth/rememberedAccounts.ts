// Client-Side Safe Remembered Account Login Hints

export interface RememberedAccount {
  sub: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  lastUsedAt: string;
}

const STORAGE_KEY = 'gdu_remembered_accounts';
const MAX_REMEMBERED = 5;

const FORBIDDEN_KEYS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'credential',
  'credentials',
  'session',
  'session_id',
  'secret',
  'password',
]);

function sanitizeAccount(input: Record<string, unknown>): RememberedAccount | null {
  if (!input || typeof input !== 'object') return null;

  const sub = typeof input.sub === 'string' && input.sub.trim() ? input.sub.trim() : null;
  const email = typeof input.email === 'string' && input.email.includes('@') ? input.email.trim() : null;

  if (!sub || !email) return null;

  // Verify picture URL is safe https if provided
  let picture: string | null = null;
  if (typeof input.picture === 'string' && input.picture.startsWith('https://')) {
    picture = input.picture;
  }

  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : null;
  const lastUsedAt =
    typeof input.lastUsedAt === 'string' && !isNaN(Date.parse(input.lastUsedAt))
      ? input.lastUsedAt
      : new Date().toISOString();

  // Create clean strictly shaped object
  const clean: RememberedAccount = {
    sub,
    email,
    name,
    picture,
    lastUsedAt,
  };

  // Double check no forbidden properties leak
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      delete (clean as unknown as Record<string, unknown>)[key];
    }
  }

  return clean;
}

export function listRememberedAccounts(): RememberedAccount[] {
  if (typeof localStorage === 'undefined') return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const validAccounts: RememberedAccount[] = [];
    for (const item of parsed) {
      const sanitized = sanitizeAccount(item);
      if (sanitized) {
        validAccounts.push(sanitized);
      }
    }

    return validAccounts.sort(
      (a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
    );
  } catch {
    return [];
  }
}

function notifyChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('gdu:remembered_accounts_changed'));
  }
}

export function rememberAccount(account: {
  sub: string;
  email: string;
  name?: string | null;
  picture?: string | null;
}): RememberedAccount[] {
  if (typeof localStorage === 'undefined') return [];

  const existing = listRememberedAccounts();
  const sanitized = sanitizeAccount({
    ...account,
    lastUsedAt: new Date().toISOString(),
  });

  if (!sanitized) return existing;

  // Filter out existing matching sub or email
  const filtered = existing.filter(
    (acc) => acc.sub !== sanitized.sub && acc.email.toLowerCase() !== sanitized.email.toLowerCase()
  );

  // Prepend newest
  const updated = [sanitized, ...filtered].slice(0, MAX_REMEMBERED);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    notifyChanged();
  } catch {
    // QuotaExceeded or disabled
  }

  return updated;
}

export function forgetRememberedAccount(subOrEmail: string): RememberedAccount[] {
  if (typeof localStorage === 'undefined') return [];

  const target = subOrEmail.toLowerCase().trim();
  const existing = listRememberedAccounts();
  const updated = existing.filter(
    (acc) => acc.sub !== subOrEmail && acc.email.toLowerCase() !== target
  );

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    notifyChanged();
  } catch {
    // Ignore storage errors
  }

  return updated;
}

export function clearRememberedAccounts(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    notifyChanged();
  } catch {
    // Ignore storage errors
  }
}

export function getLoginUrlWithHint(account: { email: string }): string {
  return `/api/v1/auth/google/start?login_hint=${encodeURIComponent(account.email)}`;
}
