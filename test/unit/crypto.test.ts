import { describe, it, expect } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  hashOpaqueToken,
  generateSecureRandomString,
  timingSafeEqual,
} from '../../src/worker/services/crypto';

describe('Application Cryptography (AES-GCM & SHA-256)', () => {
  const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const ALT_KEY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

  it('performs AES-GCM encryption and decryption roundtrip', async () => {
    const plaintext = '1//0gM7Xsample-refresh-token-value';
    const encrypted = await encryptSecret(plaintext, TEST_KEY, 'user-123');

    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.keyVersion).toBe(1);

    const decrypted = await decryptSecret(encrypted.ciphertext, encrypted.iv, TEST_KEY, 'user-123');
    expect(decrypted).toBe(plaintext);
  });

  it('generates unique random IVs for identical plaintext', async () => {
    const plaintext = 'identical-secret';
    const enc1 = await encryptSecret(plaintext, TEST_KEY);
    const enc2 = await encryptSecret(plaintext, TEST_KEY);

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
  });

  it('fails decryption when wrong key is provided', async () => {
    const plaintext = 'secret-data';
    const encrypted = await encryptSecret(plaintext, TEST_KEY);

    await expect(decryptSecret(encrypted.ciphertext, encrypted.iv, ALT_KEY)).rejects.toThrow();
  });

  it('fails decryption when AAD does not match', async () => {
    const plaintext = 'secret-data';
    const encrypted = await encryptSecret(plaintext, TEST_KEY, 'user-123');

    await expect(
      decryptSecret(encrypted.ciphertext, encrypted.iv, TEST_KEY, 'wrong-user')
    ).rejects.toThrow();
  });

  it('hashes opaque tokens deterministically with SHA-256', async () => {
    const token = 'session-token-xyz';
    const hash1 = await hashOpaqueToken(token);
    const hash2 = await hashOpaqueToken(token);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // hex sha256
    expect(hash1).not.toBe(token);
  });

  it('generates secure random strings of expected length', () => {
    const rand1 = generateSecureRandomString(32);
    const rand2 = generateSecureRandomString(32);

    expect(rand1).not.toBe(rand2);
    expect(rand1.length).toBeGreaterThanOrEqual(32);
  });

  it('compares fixed-length strings in timing-safe manner', () => {
    expect(timingSafeEqual('hash1234567890', 'hash1234567890')).toBe(true);
    expect(timingSafeEqual('hash1234567890', 'hash1234567891')).toBe(false);
    expect(timingSafeEqual('short', 'longer-string')).toBe(false);
  });
});
