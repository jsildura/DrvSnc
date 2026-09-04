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

function isPrivateOrReservedIpv4(ip32: number): boolean {
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

  return false;
}

/**
 * Expand an IPv6 literal into its eight 16-bit groups, or null if it is not one.
 *
 * Both the compressed hex form and a trailing dotted quad are accepted, because they describe the
 * same address and only one of them survives `new URL()`: the WHATWG serializer rewrites
 * `::ffff:169.254.169.254` as `::ffff:a9fe:a9fe`, so matching on the readable form alone let the
 * cloud metadata endpoint through.
 */
function parseIpv6Groups(host: string): number[] | null {
  // A scope id names a local interface; it says nothing about which address this is.
  let text = host.split('%')[0];
  if (!text.includes(':')) return null;

  const dotted = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const ip32 = parseIpv4ToUint32(dotted[1]);
    if (ip32 === null || dotted.index === undefined) return null;
    const high = ((ip32 >>> 16) & 0xffff).toString(16);
    const low = (ip32 & 0xffff).toString(16);
    text = `${text.slice(0, dotted.index)}${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const toGroups = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];
    for (const piece of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };

  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !tail) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;

  // `::` has to stand for at least one group, otherwise the address was already full-length.
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;

  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

function isPrivateOrReservedIpv6(host: string): boolean {
  const groups = parseIpv6Groups(host);
  if (!groups) return false;

  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;

  if (groups.every((g) => g === 0)) return true; // :: unspecified
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7  unique local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8  multicast

  // An IPv4 address carried inside an IPv6 one reaches exactly the host the bare address would, so
  // the IPv4 rules have to apply to the embedded half: ::ffff:0:0/96 (mapped), ::/96 (compatible,
  // which is also where ::1 lands) and 64:ff9b::/96 (NAT64).
  const zeroPrefix = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  const isNat64 = g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;

  if ((zeroPrefix && (g5 === 0xffff || g5 === 0)) || isNat64) {
    const embedded = (((g6 << 16) | g7) >>> 0);
    // ::1 is loopback; every other ::/96 address is an IPv4 one to be judged as such.
    return embedded === 1 || isPrivateOrReservedIpv4(embedded);
  }

  return false;
}

export function isPrivateOrReservedIp(host: string): boolean {
  const cleanHost = host.replace(/^\[|\]$/g, '').toLowerCase();

  // Only an address literal can be classified here. A hostname resolves to whatever DNS says, and
  // pattern-matching one as an IP is what made `fc2.com` read as an fc00::/7 unique-local address
  // and get refused outright.
  if (cleanHost.includes(':')) {
    return isPrivateOrReservedIpv6(cleanHost);
  }

  const ip32 = parseIpv4ToUint32(cleanHost);
  return ip32 !== null && isPrivateOrReservedIpv4(ip32);
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

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, error: 'Remote download source must use https: protocol' };
  }

  const defaultPort = parsed.protocol === 'http:' ? '80' : '443';
  if (parsed.port && parsed.port !== defaultPort) {
    return { valid: false, error: 'Only standard HTTPS port 443 is permitted' };
  }

  // A pasted http:// link is upgraded rather than refused. Media hosts routinely answer plain HTTP
  // with a 301 to their own TLS endpoint, so rejecting the scheme turned links that work perfectly
  // well into "must use https" errors. The transfer itself still never runs in plaintext: what gets
  // stored and fetched is the rewritten https URL.
  if (parsed.protocol === 'http:') {
    parsed.port = '';
    parsed.protocol = 'https:';
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
  // Normalize encoder hostnames lacking DNS records (e.g. s97.online-audio-converter.com -> s97.video-converter.com)
  const isAudioConverter = urlStr.includes('online-audio-converter.com') || urlStr.includes('/aconv/');
  const effectiveUrl = urlStr.replace(/([a-zA-Z0-9_-]+)\.online-audio-converter\.com/g, '$1.video-converter.com');

  const validation = validateRemoteUrl(effectiveUrl);
  if (!validation.valid) {
    throw new Error(`SSRF policy violation: ${validation.error}`);
  }

  if (redirectCount > maxRedirects) {
    throw new Error(`Maximum redirect limit exceeded (max ${maxRedirects})`);
  }

  const sanitizedHeaders = new Headers(init?.headers);
  if (isAudioConverter) {
    sanitizedHeaders.set('Referer', 'https://online-audio-converter.com/');
    sanitizedHeaders.set('Origin', 'https://online-audio-converter.com');
  } else if (effectiveUrl.includes('convert.io') || effectiveUrl.includes('/convert/')) {
    sanitizedHeaders.set('Referer', 'https://convert.io/');
    sanitizedHeaders.set('Origin', 'https://convert.io');
  } else if (effectiveUrl.includes('video-converter.com')) {
    sanitizedHeaders.set('Referer', 'https://video-converter.com/');
    sanitizedHeaders.set('Origin', 'https://video-converter.com');
  }
  // Strip sensitive headers across redirects
  if (redirectCount > 0) {
    sanitizedHeaders.delete('Authorization');
    sanitizedHeaders.delete('Cookie');
  }

  const response = await fetch(effectiveUrl, {
    ...init,
    headers: sanitizedHeaders,
    redirect: 'manual',
  });

  // Handle redirects
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('Location');
    // The redirect's own body is never of interest, and leaving it unread holds the connection open
    // for as long as the isolate lives.
    await response.body?.cancel().catch(() => undefined);

    if (!location) {
      throw new Error(`Redirect response status ${response.status} missing Location header`);
    }

    const targetUrl = new URL(location, urlStr).toString();
    return fetchRemoteWithPolicy(targetUrl, init, maxRedirects, redirectCount + 1);
  }

  return response;
}
