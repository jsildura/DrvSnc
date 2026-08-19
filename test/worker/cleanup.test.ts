import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { handleScheduledCleanup } from '../../src/worker/scheduled/cleanup';

describe('Scheduled Cleanup Service', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);

    const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const tenMinsAgoIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    // Seed User
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind('usr-clean-1', 'sub-clean-1', 'clean@example.com', 'Clean User', null)
      .run();

    // Seed expired session
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind('sess-expired', 'usr-clean-1', 'hash-expired', 'csrf-expired', yesterdayIso)
      .run();

    // Seed expired OAuth state
    await env.DB.prepare(
      `INSERT INTO oauth_states (state, code_verifier, redirect_uri, expires_at)
       VALUES (?, ?, ?, ?)`
    )
      .bind('expired-state', 'verifier-expired', 'https://example.com/api/v1/auth/google/callback', tenMinsAgoIso)
      .run();

    // Seed batch with one retained child job
    await env.DB.prepare(
      `INSERT INTO upload_batches (id, user_id, destination_folder_id, destination_folder_name, item_count)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind('bch-child', 'usr-clean-1', null, null, 1)
      .run();

    await env.DB.prepare(
      `INSERT INTO upload_jobs (id, user_id, source_kind, filename, file_size, mime_type, status, batch_id)
       VALUES (?, ?, 'remote', 'child.txt', 10, 'text/plain', 'completed', ?)`
    )
      .bind('job-bch-child', 'usr-clean-1', 'bch-child')
      .run();
  });

  it('cleans expired sessions and expired oauth states', async () => {
    const result = await handleScheduledCleanup(env);
    expect(result.expiredSessions).toBeGreaterThanOrEqual(1);
    expect(result.expiredStates).toBeGreaterThanOrEqual(1);

    // Verify session is deleted
    const session = await env.DB.prepare(
      `SELECT * FROM sessions WHERE id = ?`
    )
      .bind('sess-expired')
      .first();
    expect(session).toBeNull();

    // Verify oauth state is deleted
    const state = await env.DB.prepare(
      `SELECT * FROM oauth_states WHERE state = ?`
    )
      .bind('expired-state')
      .first();
    expect(state).toBeNull();

    // Orphan batch reclaimed, batch with children retained
    const kept = await env.DB.prepare(`SELECT * FROM upload_batches WHERE id = ?`)
      .bind('bch-child')
      .first();
    expect(kept).not.toBeNull();
  });

  it('reclaims orphaned batch rows only after child job history is deleted', async () => {
    // Seed orphan batch (no child jobs) immediately before the cleanup run
    await env.DB.prepare(
      `INSERT INTO upload_batches (id, user_id, destination_folder_id, destination_folder_name, item_count)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind('bch-orphan', 'usr-clean-1', null, null, 0)
      .run();

    const first = await handleScheduledCleanup(env);
    expect(first.removedBatches).toBeGreaterThanOrEqual(1);

    const orphan = await env.DB.prepare(`SELECT * FROM upload_batches WHERE id = ?`)
      .bind('bch-orphan')
      .first();
    expect(orphan).toBeNull();

    const retained = await env.DB.prepare(`SELECT * FROM upload_batches WHERE id = ?`)
      .bind('bch-child')
      .first();
    expect(retained).not.toBeNull();

    // Simulate job history deletion of the last child, then reclaim on next run
    await env.DB.prepare(`DELETE FROM upload_jobs WHERE id = ?`)
      .bind('job-bch-child')
      .run();

    const second = await handleScheduledCleanup(env);
    expect(second.removedBatches).toBeGreaterThanOrEqual(1);

    const gone = await env.DB.prepare(`SELECT * FROM upload_batches WHERE id = ?`)
      .bind('bch-child')
      .first();
    expect(gone).toBeNull();
  });
});
