import { describe, it, expect } from 'vitest';
import {
  signStreamTicket,
  verifyStreamTicket,
  base64UrlEncode,
  base64UrlDecode,
} from '../../src/worker/services/streamTicket';

describe('streamTicket service', () => {
  const secret = 'super-secret-key-12345';

  it('signs and verifies a valid stream ticket', async () => {
    const payload = {
      fid: 'file-123',
      uid: 'user-abc',
      fn: 'archive.zip',
      exp: Date.now() + 60000,
    };

    const ticket = await signStreamTicket(secret, payload);
    expect(ticket).toContain('.');

    const verified = await verifyStreamTicket(secret, ticket);
    expect(verified).not.toBeNull();
    expect(verified?.fid).toBe('file-123');
    expect(verified?.uid).toBe('user-abc');
    expect(verified?.fn).toBe('archive.zip');
    expect(verified?.exp).toBe(payload.exp);
  });

  it('rejects an expired stream ticket', async () => {
    const payload = {
      fid: 'file-123',
      uid: 'user-abc',
      fn: 'archive.zip',
      exp: Date.now() - 1000, // expired
    };

    const ticket = await signStreamTicket(secret, payload);
    const verified = await verifyStreamTicket(secret, ticket);
    expect(verified).toBeNull();
  });

  it('rejects a ticket signed with a different secret', async () => {
    const payload = {
      fid: 'file-123',
      uid: 'user-abc',
      fn: 'archive.zip',
      exp: Date.now() + 60000,
    };

    const ticket = await signStreamTicket(secret, payload);
    const verified = await verifyStreamTicket('different-secret-key', ticket);
    expect(verified).toBeNull();
  });

  it('rejects malformed or tampered tickets', async () => {
    expect(await verifyStreamTicket(secret, 'not-a-valid-ticket')).toBeNull();
    expect(await verifyStreamTicket(secret, 'tampered.sig')).toBeNull();
  });

  it('correctly encodes and decodes base64Url without padding', () => {
    const enc = new TextEncoder();
    const data = enc.encode('Hello, world! Testing base64url characters +/=');
    const encoded = base64UrlEncode(data);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');

    const decoded = base64UrlDecode(encoded);
    const str = new TextDecoder().decode(decoded);
    expect(str).toBe('Hello, world! Testing base64url characters +/=');
  });
});
