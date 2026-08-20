import { describe, it, expect, vi } from 'vitest';
import {
  validateRemoteUrl,
  redactSourceUrl,
  fetchRemoteWithPolicy,
  isPrivateOrReservedIp,
} from '../../src/worker/services/remoteUrlPolicy';

describe('Remote URL & SSRF Policy Enforcement', () => {
  describe('IP Address Filtering (isPrivateOrReservedIp)', () => {
    it('detects IPv4 loopback, private, link-local, and reserved ranges', () => {
      expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('127.255.255.254')).toBe(true);
      expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true);
      expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true);
      expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
      expect(isPrivateOrReservedIp('0.0.0.0')).toBe(true);
      expect(isPrivateOrReservedIp('224.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('240.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
      expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);
    });

    it('detects IPv6 loopback, link-local, and IPv4-mapped private ranges', () => {
      expect(isPrivateOrReservedIp('::1')).toBe(true);
      expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
      expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('::ffff:10.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('::ffff:192.168.1.1')).toBe(true);
      expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false);
    });

    it('classifies an IPv4-mapped address written in hex, as the URL parser rewrites it', () => {
      // `new URL('http://[::ffff:169.254.169.254]/')` serializes its host as `[::ffff:a9fe:a9fe]`, so
      // the hex form is the only one the policy ever actually sees.
      expect(isPrivateOrReservedIp('::ffff:a9fe:a9fe')).toBe(true); // 169.254.169.254
      expect(isPrivateOrReservedIp('::ffff:7f00:1')).toBe(true); // 127.0.0.1
      expect(isPrivateOrReservedIp('::ffff:c0a8:101')).toBe(true); // 192.168.1.1
      expect(isPrivateOrReservedIp('[::ffff:a9fe:a9fe]')).toBe(true);
      // A public address in the same form stays reachable.
      expect(isPrivateOrReservedIp('::ffff:808:808')).toBe(false); // 8.8.8.8
    });

    it('covers the other embeddings of an IPv4 address', () => {
      expect(isPrivateOrReservedIp('::7f00:1')).toBe(true); // IPv4-compatible loopback
      expect(isPrivateOrReservedIp('64:ff9b::a9fe:a9fe')).toBe(true); // NAT64 to link-local
      expect(isPrivateOrReservedIp('64:ff9b::808:808')).toBe(false); // NAT64 to 8.8.8.8
      expect(isPrivateOrReservedIp('::')).toBe(true);
      expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
      expect(isPrivateOrReservedIp('fd12:3456::1')).toBe(true);
      expect(isPrivateOrReservedIp('ff02::1')).toBe(true);
      expect(isPrivateOrReservedIp('fe80::1%eth0')).toBe(true);
    });

    it('does not read a hostname as an IP literal', () => {
      // These were refused outright by prefix matching on `fc`/`fd`, which are perfectly ordinary
      // first letters for a domain name.
      expect(isPrivateOrReservedIp('fc2.com')).toBe(false);
      expect(isPrivateOrReservedIp('fdn-cdn.example.com')).toBe(false);
      expect(isPrivateOrReservedIp('fe80.example.com')).toBe(false);
      expect(isPrivateOrReservedIp('example.com')).toBe(false);
      expect(isPrivateOrReservedIp('')).toBe(false);
    });
  });

  describe('validateRemoteUrl', () => {
    it('approves legitimate public HTTPS URLs', () => {
      const result = validateRemoteUrl('https://example.com/data/archive.zip');
      expect(result.valid).toBe(true);
      expect(result.normalizedUrl).toBe('https://example.com/data/archive.zip');
    });

    it('rejects protocols that cannot carry a download (ftp, file, data)', () => {
      expect(validateRemoteUrl('ftp://example.com/file.zip').valid).toBe(false);
      expect(validateRemoteUrl('file:///etc/passwd').valid).toBe(false);
      expect(validateRemoteUrl('data:text/plain,hello').valid).toBe(false);
    });

    it('upgrades http to https rather than refusing it', () => {
      const result = validateRemoteUrl('http://example.com/file.zip');
      expect(result.valid).toBe(true);
      expect(result.normalizedUrl).toBe('https://example.com/file.zip');
    });

    it('preserves the query string when upgrading a signed delivery link', () => {
      const result = validateRemoteUrl(
        'http://videos15.example.com/remote_control.php?file=abc123.mp4&acctoken=zzz'
      );
      expect(result.valid).toBe(true);
      expect(result.normalizedUrl).toBe(
        'https://videos15.example.com/remote_control.php?file=abc123.mp4&acctoken=zzz'
      );
    });

    it('drops the redundant port when upgrading http on port 80', () => {
      expect(validateRemoteUrl('http://example.com:80/file.zip').normalizedUrl).toBe(
        'https://example.com/file.zip'
      );
    });

    it('rejects an http URL on a non-standard port', () => {
      expect(validateRemoteUrl('http://example.com:8080/file.zip').valid).toBe(false);
    });

    it('applies host filtering to upgraded http URLs', () => {
      expect(validateRemoteUrl('http://127.0.0.1/file.zip').valid).toBe(false);
      expect(validateRemoteUrl('http://169.254.169.254/latest/meta-data/').valid).toBe(false);
      expect(validateRemoteUrl('http://localhost/file.zip').valid).toBe(false);
      expect(validateRemoteUrl('http://user:pass@example.com/file.zip').valid).toBe(false);
    });

    it('rejects URLs with credentials', () => {
      const res = validateRemoteUrl('https://user:password@example.com/secret.iso');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Credentials');
    });

    it('rejects non-standard ports', () => {
      expect(validateRemoteUrl('https://example.com:8080/file.zip').valid).toBe(false);
      expect(validateRemoteUrl('https://example.com:80/file.zip').valid).toBe(false);
      expect(validateRemoteUrl('https://example.com:443/file.zip').valid).toBe(true);
    });

    it('rejects internal and cloud metadata hostnames', () => {
      expect(validateRemoteUrl('https://localhost/file.zip').valid).toBe(false);
      expect(validateRemoteUrl('https://app.localhost/file.zip').valid).toBe(false);
      expect(validateRemoteUrl('https://metadata.google.internal/computeMetadata/v1/').valid).toBe(false);
      expect(validateRemoteUrl('https://instance-data.ec2.internal/').valid).toBe(false);
      expect(validateRemoteUrl('https://169.254.169.254/latest/meta-data/').valid).toBe(false);
      expect(validateRemoteUrl('https://127.0.0.1/file.zip').valid).toBe(false);
    });

    it('rejects a metadata endpoint hidden in an IPv6 literal', () => {
      expect(validateRemoteUrl('https://[::ffff:169.254.169.254]/latest/meta-data/').valid).toBe(
        false
      );
      expect(validateRemoteUrl('http://[::ffff:127.0.0.1]/file.zip').valid).toBe(false);
      expect(validateRemoteUrl('https://[::1]/file.zip').valid).toBe(false);
      expect(validateRemoteUrl('https://[fd00::1]/file.zip').valid).toBe(false);
    });

    it('admits a public host whose name looks like an IPv6 prefix', () => {
      expect(validateRemoteUrl('https://fc2.com/video.mp4').valid).toBe(true);
      expect(validateRemoteUrl('https://[2606:4700:4700::1111]/file.zip').valid).toBe(true);
    });
  });

  describe('redactSourceUrl', () => {
    it('redacts sensitive query strings and credentials', () => {
      const safe = redactSourceUrl('https://example.com/file.zip?token=secret123&signature=abc');
      expect(safe).not.toContain('secret123');
      expect(safe).toContain('https://example.com/file.zip');
    });
  });

  describe('fetchRemoteWithPolicy (manual redirects & limits)', () => {
    it('follows safe redirects and rejects redirects to private IPs', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url === 'https://example.com/redirect-to-private') {
          return new Response(null, {
            status: 302,
            headers: { Location: 'https://127.0.0.1/internal-secret' },
          });
        }

        if (url === 'https://example.com/safe-start') {
          return new Response(null, {
            status: 302,
            headers: { Location: 'https://cdn.example.com/final-file.iso' },
          });
        }

        if (url === 'https://cdn.example.com/final-file.iso') {
          return new Response('File data', {
            status: 200,
            headers: { 'Content-Type': 'application/octet-stream' },
          });
        }

        return originalFetch(input);
      });

      try {
        // Safe redirect succeeds
        const safeRes = await fetchRemoteWithPolicy('https://example.com/safe-start');
        expect(safeRes.status).toBe(200);

        // Redirect to private IP is blocked
        await expect(
          fetchRemoteWithPolicy('https://example.com/redirect-to-private')
        ).rejects.toThrow('SSRF policy violation');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('rejects redirect loops exceeding 5 hops', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => {
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://example.com/loop' },
        });
      });

      try {
        await expect(fetchRemoteWithPolicy('https://example.com/loop')).rejects.toThrow(
          'Maximum redirect limit exceeded'
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
