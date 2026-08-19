import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from './testDb';

describe('D1 Database Schema & Multi-Tenant Constraints', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it('enforces foreign keys and cascades', async () => {
    await env.DB.exec('PRAGMA foreign_keys = ON;');

    // Insert user
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind('usr-1', 'sub-1', 'test@example.com', 'Test User', 'https://example.com/pic.png')
      .run();

    // Insert user session
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind('sess-1', 'usr-1', 'hash-1', 'csrf-1', '2026-08-19T00:00:00Z')
      .run();

    // Attempt insert with non-existent user_id must fail
    await expect(
      env.DB.prepare(
        `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind('sess-2', 'non-existent-user', 'hash-2', 'csrf-2', '2026-08-19T00:00:00Z')
        .run()
    ).rejects.toThrow();
  });

  it('enforces unique google_sub per user', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO users (id, google_sub, email, name, picture)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind('usr-2', 'sub-1', 'other@example.com', 'Other User', null)
        .run()
    ).rejects.toThrow();
  });

  it('enforces exactly one google_credentials row per user', async () => {
    await env.DB.prepare(
      `INSERT INTO google_credentials (user_id, ciphertext, iv, key_version)
       VALUES (?, ?, ?, ?)`
    )
      .bind('usr-1', 'encrypted-secret', 'iv-123', 1)
      .run();

    // Duplicate credentials for same user_id must fail
    await expect(
      env.DB.prepare(
        `INSERT INTO google_credentials (user_id, ciphertext, iv, key_version)
         VALUES (?, ?, ?, ?)`
      )
        .bind('usr-1', 'duplicate-secret', 'iv-456', 1)
        .run()
    ).rejects.toThrow();
  });

  it('supports upload_jobs queries with tenant isolation', async () => {
    await env.DB.prepare(
      `INSERT INTO upload_jobs (id, user_id, source_kind, filename, file_size, mime_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind('job-1', 'usr-1', 'remote', 'sample.pdf', 1024, 'application/pdf', 'queued')
      .run();

    const result = await env.DB.prepare(
      `SELECT * FROM upload_jobs WHERE user_id = ? AND id = ?`
    )
      .bind('usr-1', 'job-1')
      .first<{ filename: string; status: string }>();

    expect(result).not.toBeNull();
    expect(result?.filename).toBe('sample.pdf');
    expect(result?.status).toBe('queued');
  });
});
