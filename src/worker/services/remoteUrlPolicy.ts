// Remote URL & SSRF Policy Enforcement

function parseIpv4ToUint32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (let i = 0; i < 4; i++) {
    const n = Number(parts[i]);
    if (isNaN(n) || n < 0 || n > 255 || parts[i].trim() !== String(n)) {
      return null;
    }
    result = (result << 8) | n;
  }
  return result >>> 0;
}

export function isPrivateOrReservedIp(host: string): boolean {
  const cleanHost = host.replace(/^\[|\]$/g, '').toLowerCase();

  // IPv4-mapped IPv6 check (e.g. ::ffff:127.0.0.1)
  if (cleanHost.startsWith('::ffff:')) {
    const mappedIpv4 = cleanHost.substring(7);
    return isPrivateOrReservedIp(mappedIpv4);
  }

  // Pure IPv6 checks
  if (
    cleanHost === '::1' ||
    cleanHost === '::' ||
    cleanHost.startsWith('fe80:') ||
    cleanHost.startsWith('fc') ||
    cleanHost.startsWith('fd')
  ) {
    return true;
  }

  // IPv4 checks
  const ip32 = parseIpv4ToUint32(cleanHost);
  if (ip32 !== null) {
    // 0.0.0.0/8
    if (((ip32 & 0xff000000) >>> 0) === 0x00000000) return true;
    // 10.0.0.0/8
    if (((ip32 & 0xff000000) >>> 0) === 0x0a000000) return true;
    // 100.64.0.0/10 (CGNAT)
    if (((ip32 & 0xffc00000) >>> 0) === 0x64400000) return true;
    // 127.0.0.0/8 (Loopback)
    if (((ip32 & 0xff000000) >>> 0) === 0x7f000000) return true;
    // 169.254.0.0/16 (Link-local)
    if (((ip32 & 0xffff0000) >>> 0) === 0xa9fe0000) return true;
    // 172.16.0.0/12 (Private)
    if (((ip32 & 0xfff00000) >>> 0) === 0xac100000) return true;
    // 192.168.0.0/16 (Private)
    if (((ip32 & 0xffff0000) >>> 0) === 0xc0a80000) return true;
    // 224.0.0.0/4 (Multicast)
    if (((ip32 & 0xf0000000) >>> 0) === 0xe0000000) return true;
    // 240.0.0.0/4 (Reserved)
    if (((ip32 & 0xf0000000) >>> 0) === 0xf0000000) return true;
  }

  return false;
}

export function validateRemoteUrl(rawUrl: string): {
  valid: boolean;
  normalizedUrl?: string;
  error?: string;
} {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL must be a non-empty string' };
  }

  if (rawUrl.length > 2048) {
    return { valid: false, error: 'URL exceeds maximum length of 2048 characters' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, error: 'Malformed URL format' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'Remote download source must use https: protocol' };
  }

  if (parsed.port && parsed.port !== '443') {
    return { valid: false, error: 'Only standard HTTPS port 443 is permitted' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'Credentials in URL are strictly prohibited' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Internal and local host aliases
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.corp') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.home') ||
    hostname === 'metadata.google.internal' ||
    hostname === 'instance-data.ec2.internal'
  ) {
    return { valid: false, error: `Access to internal host '${hostname}' is blocked` };
  }

  // IP Address check
  if (isPrivateOrReservedIp(hostname)) {
    return { valid: false, error: `Access to private or reserved IP '${hostname}' is blocked` };
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
  };
}

export function redactSourceUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return urlStr;
  }
}

export async function fetchRemoteWithPolicy(
  urlStr: string,
  init?: RequestInit,
  maxRedirects = 5,
  redirectCount = 0
): Promise<Response> {
  const validation = validateRemoteUrl(urlStr);
  if (!validation.valid) {
    throw new Error(`SSRF policy violation: ${validation.error}`);
  }

  if (redirectCount > maxRedirects) {
    throw new Error(`Maximum redirect limit exceeded (max ${maxRedirects})`);
  }

  const sanitizedHeaders = new Headers(init?.headers);
  // Strip sensitive headers across redirects
  if (redirectCount > 0) {
    sanitizedHeaders.delete('Authorization');
    sanitizedHeaders.delete('Cookie');
  }

  const response = await fetch(urlStr, {
    ...init,
    headers: sanitizedHeaders,
    redirect: 'manual',
  });

  // Handle redirects
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('Location');
    if (!location) {
      throw new Error(`Redirect response status ${response.status} missing Location header`);
    }

    const targetUrl = new URL(location, urlStr).toString();
    return fetchRemoteWithPolicy(targetUrl, init, maxRedirects, redirectCount + 1);
  }

  return response;
}
