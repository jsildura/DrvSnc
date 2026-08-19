// Utilities for AES-GCM encryption, SHA-256 hashing, and timing-safe comparison

function parseKeyBytes(key?: string): Uint8Array {
  const safeKey = key || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  // If 64 hex chars (32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(safeKey)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(safeKey.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  // If base64 encoded
  try {
    const binaryStr = atob(safeKey);
    if (binaryStr.length === 32) {
      const bytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return bytes;
    }
  } catch {
    // fallback to text encoder
  }

  // Fallback: coerce the raw key text to exactly 32 bytes. Slicing the *string*
  // is not enough — a single multi-byte character makes the encoded result
  // longer than 32 bytes and importKey then rejects it as an invalid AES key.
  const encoded = new TextEncoder().encode(safeKey);
  const bytes = new Uint8Array(32).fill(0x30); // '0' padding
  bytes.set(encoded.subarray(0, 32));
  return bytes;
}

function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function encryptSecret(
  plaintext: string,
  keyString?: string,
  aad?: string
): Promise<{ ciphertext: string; iv: string; keyVersion: number }> {
  const keyBytes = parseKeyBytes(keyString);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedPlaintext = new TextEncoder().encode(plaintext);
  const additionalData = aad ? (new TextEncoder().encode(aad) as unknown as BufferSource) : undefined;

  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
      additionalData,
    },
    cryptoKey,
    encodedPlaintext as unknown as BufferSource
  );

  return {
    ciphertext: bufferToBase64(encryptedBuffer),
    iv: bufferToBase64(iv),
    keyVersion: 1,
  };
}

export async function decryptSecret(
  ciphertextB64: string,
  ivB64: string,
  keyString?: string,
  aad?: string
): Promise<string> {
  const keyBytes = parseKeyBytes(keyString);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const iv = base64ToBuffer(ivB64);
  const ciphertextBuffer = base64ToBuffer(ciphertextB64);
  const additionalData = aad ? (new TextEncoder().encode(aad) as unknown as BufferSource) : undefined;

  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
      additionalData,
    },
    cryptoKey,
    ciphertextBuffer as unknown as BufferSource
  );

  return new TextDecoder().decode(decryptedBuffer);
}

export async function hashOpaqueToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const digestBuffer = await crypto.subtle.digest('SHA-256', encoded as unknown as BufferSource);
  const bytes = new Uint8Array(digestBuffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateSecureRandomString(bytesCount = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesCount));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let mismatch = a.length === b.length ? 0 : 1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const codeA = a.charCodeAt(i) || 0;
    const codeB = b.charCodeAt(i) || 0;
    mismatch |= codeA ^ codeB;
  }
  return mismatch === 0;
}
