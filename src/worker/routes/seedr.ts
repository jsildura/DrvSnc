import { Hono } from 'hono';
import { Env } from '../env';
import { requireSession, AuthenticatedSession } from '../middleware/session';
import { requireCsrf } from '../middleware/csrf';
import { AccountView } from '../../shared/contracts';
import {
  getSeedrDeviceCode,
  pollSeedrDeviceAuthorization,
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

// 1. GET /status - check connection status, premium tier & real space quota
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

    const spaceUsed = settings?.spaceUsed ?? contents?.space_used ?? 0;
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
      tokens.refresh_token,
      username
    );
    return c.json({ success: true, username });
  } catch (err) {
    return c.json(
      { error: (err as Error).message || 'Invalid Seedr login credentials' },
      400
    );
  }
});

// 2. POST /device/code - initiate device code flow
seedrRoutes.post('/device/code', async (c) => {
  try {
    const data = await getSeedrDeviceCode();
    return c.json(data);
  } catch (err) {
    return c.json(
      { error: (err as Error).message || 'Failed to get Seedr device code' },
      500
    );
  }
});

// 3. POST /device/authorize - poll/finalize authorization
seedrRoutes.post('/device/authorize', async (c) => {
  const user = c.get('user')!;
  const body = (await c.req.json().catch(() => ({}))) as { deviceCode?: string };
  const deviceCode = body.deviceCode;

  if (!deviceCode) {
    return c.json({ error: 'deviceCode is required' }, 400);
  }

  try {
    const res = await pollSeedrDeviceAuthorization(deviceCode);
    if (res.status && res.tokens) {
      await saveSeedrCredentials(
        c.env,
        user.id,
        res.tokens.access_token,
        res.tokens.refresh_token,
        'Seedr Account'
      );
      return c.json({ success: true });
    }

    return c.json({
      success: false,
      response: res.response || 'pending',
    });
  } catch (err) {
    return c.json(
      { error: (err as Error).message || 'Authorization failed' },
      500
    );
  }
});

// 4. DELETE /disconnect - disconnect Seedr account
seedrRoutes.delete('/disconnect', requireCsrf, async (c) => {
  const user = c.get('user')!;
  await deleteSeedrCredentials(c.env, user.id);
  return c.json({ success: true });
});

// 5. POST /transfer - add magnet link, stream to Google Drive
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
    // 1. Add magnet to Seedr cloud
    const addRes = await addSeedrMagnet(c.env, user.id, magnet);

    // 2. Poll/Inspect Seedr contents to check if file completed immediately (cached)
    const contents = await getSeedrContents(c.env, user.id);

    // Check if a folder or file was created with files ready
    let directDownloadUrl: string | null = null;
    let finalFilename = body.filename || addRes.title || 'Torrent Download';
    let seedrItemId: string | number | null = null;
    let seedrItemType: 'file' | 'folder' | 'torrent' = 'torrent';

    if (contents.files.length > 0) {
      const topFile = contents.files[0];
      directDownloadUrl = await fetchSeedrFileUrl(c.env, user.id, topFile.id);
      finalFilename = body.filename || topFile.name || finalFilename;
      seedrItemId = topFile.id;
      seedrItemType = 'file';
    } else if (contents.folders.length > 0) {
      const topFolder = contents.folders[0];
      directDownloadUrl = await createSeedrArchiveUrl(c.env, user.id, topFolder.id);
      finalFilename = body.filename || `${topFolder.name}.zip`;
      seedrItemId = topFolder.id;
      seedrItemType = 'folder';
    }

    // 3. If direct URL is available, initiate Google Drive transfer job
    if (directDownloadUrl) {
      const idempotencyKey = crypto.randomUUID();
      const { job, isExisting } = await createRemoteJob(c.env, user.id, idempotencyKey, {
        url: directDownloadUrl,
        filename: finalFilename,
        folderId: body.folderId || undefined,
      });

      // Trigger Workflow
      if (!isExisting && c.env.DRIVE_TRANSFER) {
        await c.env.DRIVE_TRANSFER.create({
          id: `job-${job.id}`,
          params: { jobId: job.id, userId: user.id },
        });
      }

      // Cleanup item from Seedr cloud in background to free quota
      if (seedrItemId) {
        c.executionCtx.waitUntil(
          deleteSeedrItem(c.env, user.id, seedrItemType, seedrItemId)
        );
      }

      return c.json({
        success: true,
        status: 'transferring',
        jobId: job.id,
        title: finalFilename,
        message: 'Torrent ready! Transferring directly to Google Drive...',
      });
    }

    // Otherwise Seedr is downloading the torrent from the swarm
    return c.json({
      success: true,
      status: 'downloading',
      userTorrentId: addRes.user_torrent_id,
      title: addRes.title || 'Torrent Download',
      message: 'Seedr is downloading torrent to cloud. Once ready, it will transfer to Google Drive.',
    });
  } catch (err) {
    return c.json(
      { error: (err as Error).message || 'Failed to process magnet link on Seedr' },
      500
    );
  }
});
