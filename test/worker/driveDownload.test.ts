import { describe, it, expect, beforeAll, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken, encryptSecret } from '../../src/worker/services/crypto';

// GET /files/:fileId/download fronts two different Google endpoints — alt=media for
// files that have bytes, /export for Google Workspace files that don't. These cover
// the routing decision itself, which is invisible from the response body alone.
describe('Drive download vs export routing (/api/v1/drive/files/:id/download)', () => {
  const userId = 'usr-download-test';
  const rawToken = 'raw-session-token-download-test';
  const csrfToken = 'csrf-token-download-test';
  const cookie = `gdu_session=${rawToken}; gdu_csrf=${csrfToken}`;

  beforeAll(async () => {
    await applyMigrations(env.DB);

    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, google_sub, email, name, picture) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userId, 'sub-download-test', 'download-user@example.com', 'Download User', null)
      .run();

    const enc = await encryptSecret('mock-refresh-token-value', env.TOKEN_ENCRYPTION_KEY, userId);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO google_credentials (user_id, ciphertext, iv, key_version) VALUES (?, ?, ?, ?)`
    )
      .bind(userId, enc.ciphertext, enc.iv, enc.keyVersion)
      .run();

    const tokenHash = await hashOpaqueToken(rawToken);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-download-test', userId, tokenHash, csrfToken)
      .run();
  });

  /**
   * Stand in for the Drive API. `handlers` decides what alt=media, /export and a
   * metadata GET each return; every call is recorded so the test can assert which
   * endpoints were consulted and in what order.
   */
  function mockDrive(handlers: {
    media?: () => Response;
    export?: (mime: string | null) => Response;
    metadata?: () => Response;
  }) {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'mock-fresh-access-token', expires_in: 3600 }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlStr.includes('/export')) {
        const mime = new URL(urlStr).searchParams.get('mimeType');
        calls.push(`export:${mime}`);
        return (
          handlers.export?.(mime) ??
          new Response('not exportable', { status: 403, headers: { 'Content-Type': 'text/plain' } })
        );
      }

      if (urlStr.includes('alt=media')) {
        calls.push('media');
        return handlers.media?.() ?? new Response('binary bytes', { status: 200 });
      }

      if (urlStr.includes('googleapis.com/drive/v3/files/')) {
        calls.push('metadata');
        return (
          handlers.metadata?.() ?? new Response('{}', { headers: { 'Content-Type': 'application/json' } })
        );
      }

      return originalFetch(input, init);
    }) as unknown as typeof fetch;

    return { calls, restore: () => { globalThis.fetch = originalFetch; } };
  }

  const pdfExport = () =>
    new Response('%PDF-1.4 exported', {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    });

  const notDownloadable = () =>
    new Response(
      JSON.stringify({ error: { message: 'Only files with binary content can be downloaded' } }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );

  it('exports directly when ?exportMimeType is supplied, with no metadata round-trip', async () => {
    const drive = mockDrive({ export: pdfExport });
    try {
      const res = await SELF.fetch(
        'https://example.com/api/v1/drive/files/gdoc-1/download?exportMimeType=application/pdf',
        { headers: { Cookie: cookie } }
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      // Without inline the browser downloads the PDF instead of rendering it.
      expect(res.headers.get('Content-Disposition')).toBe('inline');
      expect(await res.text()).toBe('%PDF-1.4 exported');

      // This is the viewer's hot path: it must cost exactly one upstream call, and
      // must never try alt=media on a file that has no bytes.
      expect(drive.calls).toEqual(['export:application/pdf']);
    } finally {
      drive.restore();
    }
  });

  it('falls back to an export when alt=media reports the file is not downloadable', async () => {
    const drive = mockDrive({
      media: notDownloadable,
      metadata: () =>
        new Response(
          JSON.stringify({ id: 'gdoc-2', name: 'Notes', mimeType: 'application/vnd.google-apps.document' }),
          { headers: { 'Content-Type': 'application/json' } }
        ),
      export: pdfExport,
    });

    try {
      const res = await SELF.fetch('https://example.com/api/v1/drive/files/gdoc-2/download', {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(await res.text()).toBe('%PDF-1.4 exported');

      // The export format has to come from the file's own mimeType — a Workspace doc
      // exports as PDF, and asking for the wrong format is a hard 403.
      expect(drive.calls).toEqual(['media', 'metadata', 'export:application/pdf']);
    } finally {
      drive.restore();
    }
  });

  it('tries the next export format when the preferred one is rejected', async () => {
    const drive = mockDrive({
      media: notDownloadable,
      metadata: () =>
        new Response(
          JSON.stringify({ id: 'gsheet-1', name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet' }),
          { headers: { 'Content-Type': 'application/json' } }
        ),
      export: (mime) =>
        mime === 'application/pdf'
          ? new Response('cannot export as pdf', { status: 403 })
          : new Response('xlsx bytes', {
              status: 200,
              headers: {
                'Content-Type':
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              },
            }),
    });

    try {
      const res = await SELF.fetch('https://example.com/api/v1/drive/files/gsheet-1/download', {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      expect(await res.text()).toBe('xlsx bytes');
      expect(drive.calls).toEqual([
        'media',
        'metadata',
        'export:application/pdf',
        'export:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ]);
    } finally {
      drive.restore();
    }
  });

  it('reports a failed download as itself rather than masking it as an export error', async () => {
    const drive = mockDrive({
      media: () => new Response('upstream exploded', { status: 500 }),
      metadata: () =>
        new Response(
          JSON.stringify({ id: 'file-1', name: 'photo.jpg', mimeType: 'image/jpeg' }),
          { headers: { 'Content-Type': 'application/json' } }
        ),
    });

    try {
      const res = await SELF.fetch('https://example.com/api/v1/drive/files/file-1/download', {
        headers: { Cookie: cookie },
      });

      // A 5xx is transient and retriable. Retrying it as an export would have replaced
      // it with Google's permanent-looking "not exportable" 403 and sent the user
      // chasing a permissions problem they don't have.
      expect(res.status).toBe(500);
      const body = await res.json<{ error: { code: string; retriable: boolean } }>();
      expect(body.error.retriable).toBe(true);
      expect(body.error.code).not.toBe('DRIVE_NOT_EXPORTABLE');
      expect(drive.calls).toEqual(['media']);
    } finally {
      drive.restore();
    }
  });

  it('gives up with the export error when a Workspace file cannot produce any format', async () => {
    const drive = mockDrive({
      media: notDownloadable,
      metadata: () =>
        new Response(
          JSON.stringify({ id: 'gdraw-1', name: 'Sketch', mimeType: 'application/vnd.google-apps.drawing' }),
          { headers: { 'Content-Type': 'application/json' } }
        ),
      export: () => new Response('nope', { status: 403 }),
    });

    try {
      const res = await SELF.fetch('https://example.com/api/v1/drive/files/gdraw-1/download', {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(403);
      const body = await res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('DRIVE_NOT_EXPORTABLE');
      // Every candidate format must be attempted before reporting failure.
      expect(drive.calls.filter((c) => c.startsWith('export:')).length).toBeGreaterThan(1);
    } finally {
      drive.restore();
    }
  });

  it('leaves an ordinary binary download on the alt=media path', async () => {
    const drive = mockDrive({
      media: () =>
        new Response('JPEG bytes', {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '10' },
        }),
    });

    try {
      const res = await SELF.fetch('https://example.com/api/v1/drive/files/img-1/download', {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/jpeg');
      // Not a PDF, so no inline disposition is invented for it.
      expect(res.headers.get('Content-Disposition')).toBeNull();
      expect(drive.calls).toEqual(['media']);
    } finally {
      drive.restore();
    }
  });
});
