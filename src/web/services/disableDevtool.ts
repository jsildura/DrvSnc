import DisableDevtool from 'disable-devtool';

export type DisableDevtoolConfig = Parameters<typeof DisableDevtool>[0];

export interface EnvironmentContext {
  /** Override for import.meta.env.PROD (defaults to import.meta.env.PROD) */
  prod?: boolean;
  /** Override for import.meta.env.MODE (defaults to import.meta.env.MODE) */
  mode?: string;
  /** Override for test environment flag (defaults to process.env.NODE_ENV === 'test') */
  isTest?: boolean;
  /** Override for hostname (defaults to window.location.hostname) */
  hostname?: string;
}

/**
 * Checks if the given hostname represents a local development, loopback,
 * or private network address.
 */
export function isLocalDevHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().trim();

  if (!normalized) {
    return true;
  }

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized === '0.0.0.0' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  ) {
    return true;
  }

  // IPv4 Loopback (127.0.0.0/8)
  if (/^127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/.test(normalized)) {
    return true;
  }

  // RFC1918 Private IPv4: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  if (
    /^10\.\d+\.\d+\.\d+$/.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(normalized) ||
    /^192\.168\.\d+\.\d+$/.test(normalized)
  ) {
    return true;
  }

  return false;
}

/**
 * Determines whether the current environment is live production.
 *
 * Requirements:
 * - Must run in a browser with a valid window.location.
 * - Vite build mode must be production (import.meta.env.PROD === true and import.meta.env.MODE === 'production').
 * - Must not be running under automated test suites.
 * - Must not be running on localhost, loopback, or private development addresses.
 */
export function isLiveProduction(ctx?: EnvironmentContext): boolean {
  if (typeof window === 'undefined' || !window.location) {
    return false;
  }

  // Automated test runner guard (Vitest, Jest)
  const isTest =
    ctx?.isTest ??
    (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test');
  if (isTest) {
    return false;
  }

  // Vite development mode check
  const isProd = ctx?.prod ?? import.meta.env.PROD;
  const mode = ctx?.mode ?? import.meta.env.MODE;
  if (!isProd || mode !== 'production') {
    return false;
  }

  const hostname = ctx?.hostname ?? window.location.hostname ?? '';
  if (isLocalDevHost(hostname)) {
    return false;
  }

  return true;
}

/**
 * Initializes disable-devtool strictly on live production environments.
 * Never runs on local dev or test environments.
 * Returns true if initialized, or false if skipped.
 */
export function initDisableDevtool(
  options?: DisableDevtoolConfig,
  ctx?: EnvironmentContext
): boolean {
  if (!isLiveProduction(ctx)) {
    return false;
  }

  try {
    DisableDevtool(options);
    return true;
  } catch (err) {
    console.error('Failed to initialize disable-devtool:', err);
    return false;
  }
}
