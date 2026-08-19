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
  });

  describe('validateRemoteUrl', () => {
    it('approves legitimate public HTTPS URLs', () => {
      const result = validateRemoteUrl('https://example.com/data/archive.zip');
      expect(result.valid).toBe(true);
      expect(result.normalizedUrl).toBe('https://example.com/data/archive.zip');
    });

    it('rejects non-HTTPS protocols (http, ftp, file, data)', () => {
      expect(validateRemoteUrl('http://example.com/file.zip').valid).toBe(false);
      expect(validateRemoteUrl('ftp://example.com/file.zip').valid).toBe(false);
      expect(validateRemoteUrl('file:///etc/passwd').valid).toBe(false);
      expect(validateRemoteUrl('data:text/plain,hello').valid).toBe(false);
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
