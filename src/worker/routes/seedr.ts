import { Hono } from 'hono';
import { Env } from '../env';
import { requireSession, AuthenticatedSession } from '../middleware/session';
import { requireCsrf } from '../middleware/csrf';
import { AccountView } from '../../shared/contracts';
import {
  saveSeedrCredentials,
  getSeedrCredentials,
  deleteSeedrCredentials,
  addSeedrMagnet,
  getSeedrContents,
  fetchSeedrFileUrl,
  createSeedrArchiveUrl,
  deleteSeedrItem,
  loginWithSeedrPassword,
  getSeedrSettings,
} from '../services/seedrClient';
import { createRemoteJob } from '../services/jobRepository';

export const seedrRoutes = new Hono<{
  Bindings: Env;
  Variables: {
    user?: AccountView;
    session?: AuthenticatedSession;
    requestId: string;
  };
}>();

// All Seedr routes require active session
seedrRoutes.use('*', requireSession);

// 1. GET /status - check connection status, premium tier, quota & cloud items
seedrRoutes.get('/status', async (c) => {
  const user = c.get('user')!;
  const creds = await getSeedrCredentials(c.env, user.id);

  if (!creds) {
    return c.json({
      connected: false,
    });
  }

  try {
    const [settings, contents] = await Promise.all([
      getSeedrSettings(c.env, user.id).catch(() => null),
      getSeedrContents(c.env, user.id).catch(() => null),
    ]);

    const spaceUsed = Math.max(
      settings?.spaceUsed ?? 0,
      contents?.space_used ?? 0
    );
    const spaceMax = settings?.spaceMax ?? contents?.space_max ?? 2147483648;
    const isPremium = settings?.isPremium ?? false;
    const packageName = settings?.packageName ?? (isPremium ? 'Premium' : 'Free');
    const username = settings?.username || creds.username || 'Seedr User';

    return c.json({
      connected: true,
      username,
      email: settings?.email,
      isPremium,
      packageName,
      spaceUsed,
      spaceMax,
      torrents: contents?.torrents || [],
      folders: contents?.folders || [],
      files: contents?.files || [],
    });
  } catch (err) {
    return c.json({
      connected: true,
      username: creds.username || 'Seedr User',
      isPremium: false,
      packageName: 'Free Tier',
      spaceUsed: 0,
      spaceMax: 2147483648,
      torrents: [],
      folders: [],
      files: [],
    });
  }
});

// 2. POST /login - authenticate directly with Seedr credentials
seedrRoutes.post('/login', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const body = (await c.req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };

  const username = body.username?.trim();
  const password = body.password?.trim();

  if (!username || !password) {
    return c.json({ error: 'Seedr email and password are required' }, 400);
  }

  try {
    const tokens = await loginWithSeedrPassword(username, password);
    await saveSeedrCredentials(
      c.env,
      user.id,
      tokens.access_token,
      tokens.refresh_token || '',
      username
    );

    return c.json({
      success: true,
      username,
    });
  } catch (err) {
    return c.json(
      { error: (err as Error).message || 'Invalid Seedr email or password' },
      401
    );
  }
});

// 3. DELETE /disconnect - disconnect Seedr account
seedrRoutes.delete('/disconnect', requireCsrf, async (c) => {
  const user = c.get('user')!;
  await deleteSeedrCredentials(c.env, user.id);
  return c.json({ success: true });
});

// 4. POST /transfer-item - stream an existing Seedr folder or file directly into Google Drive
seedrRoutes.post('/transfer-item', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const body = (await c.req.json().catch(() => ({}))) as {
    itemType?: 'folder' | 'file';
    itemId?: string | number;
    itemName?: string;
    folderId?: string;
    filename?: string;
  };

  if (!body.itemId || !body.itemType) {
    return c.json({ error: 'itemId and itemType are required' }, 400);
  }

  try {
    let directDownloadUrl: string;
    let finalFilename = body.filename || body.itemName || (body.itemType === 'folder' ? 'Archive.zip' : 'Download');

    if (body.itemType === 'folder') {
      directDownloadUrl = await createSeedrArchiveUrl(c.env, user.id, body.itemId);
      if (!finalFilename.toLowerCase().endsWith('.zip')) {
        finalFilename = `${finalFilename}.zip`;
      }
    } else {
      directDownloadUrl = await fetchSeedrFileUrl(c.env, user.id, body.itemId);
    }

    const idempotencyKey = crypto.randomUUID();
    const { job, isExisting } = await createRemoteJob(c.env, user.id, idempotencyKey, {
      url: directDownloadUrl,
      filename: finalFilename,
      folderId: body.folderId || undefined,
    });

    if (!isExisting && c.env.DRIVE_TRANSFER) {
      await c.env.DRIVE_TRANSFER.create({
        id: `job-${job.id}`,
        params: { jobId: job.id, userId: user.id },
      });
    }

    // Auto cleanup from Seedr
    c.executionCtx.waitUntil(
      deleteSeedrItem(c.env, user.id, body.itemType, body.itemId)
    );

    return c.json({
      success: true,
      status: 'transferring',
      jobId: job.id,
      title: finalFilename,
      message: `Started transfer for "${finalFilename}" to Google Drive!`,
    });
  } catch (err) {
    return c.json(
      { error: (err as Error).message || 'Failed to start transfer' },
      500
    );
  }
});

// 5. DELETE /item - delete item from Seedr cloud
seedrRoutes.delete('/item', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const body = (await c.req.json().catch(() => ({}))) as {
    itemType?: 'torrent' | 'folder' | 'file';
    itemId?: string | number;
  };

  if (!body.itemId || !body.itemType) {
    return c.json({ error: 'itemId and itemType are required' }, 400);
  }

  try {
    await deleteSeedrItem(c.env, user.id, body.itemType, body.itemId);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: (err as Error).message || 'Failed to delete item' }, 500);
  }
});

// 6. POST /transfer - add magnet link to Seedr cloud
seedrRoutes.post('/transfer', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const body = (await c.req.json().catch(() => ({}))) as {
    magnetLink?: string;
    folderId?: string;
    filename?: string;
  };

  const magnet = body.magnetLink?.trim();
  if (!magnet || !magnet.toLowerCase().startsWith('magnet:?')) {
    return c.json({ error: 'Valid magnet link (magnet:?xt=...) is required' }, 400);
  }

  try {
    // Add magnet to Seedr cloud — returns immediately.
    // Seedr will download the torrent in the background.
    // The frontend auto-polls /status and shows completed items in "Ready in Seedr Cloud".
    const addRes = await addSeedrMagnet(c.env, user.id, magnet);

    return c.json({
      success: true,
      status: 'downloading',
      userTorrentId: addRes.user_torrent_id,
      title: addRes.title || 'Torrent Download',
      message: 'Torrent added to Seedr cloud. It will appear in "Ready in Seedr Cloud" once downloaded.',
    });
  } catch (err) {
    return c.json(
      { error: (err as Error).message || 'Failed to add magnet link to Seedr' },
      500
    );
  }
});
