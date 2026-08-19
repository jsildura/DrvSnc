import { Hono, Context } from 'hono';
import { Env } from '../env';
import { requireSession, AuthenticatedSession } from '../middleware/session';
import { requireCsrf } from '../middleware/csrf';
import {
  AccountView,
  CreateFolderSchema,
  UpdateDriveItemSchema,
  AddPermissionSchema,
  UpdatePermissionSchema,
} from '../../shared/contracts';
import {
  listFolders,
  createFolder,
  listItems,
  searchItems,
  listShared,
  listTrash,
  getQuota,
  updateItem,
  trashItem,
  restoreItem,
  deleteItemPermanently,
  emptyTrash,
  getPermissions,
  addPermission,
  updatePermission,
  removePermission,
  downloadFile,
  exportFile,
  getExportMimeType,
  getExportMimeTypes,
  getFileMetadata,
} from '../services/driveClient';

interface ErrorLike {
  code?: string;
  message?: string;
  retriable?: boolean;
  status?: number;
}

/**
 * Work out what format a file should be exported as, or null if it isn't a Google
 * Workspace file and therefore has real bytes to download instead.
 *
 * Any failure here resolves to null rather than throwing: this is only ever consulted
 * after a download has already failed, and the download's own error is the more useful
 * one to report.
 */
async function resolveExportMimeType(
  env: Env,
  userId: string,
  fileId: string
): Promise<{ preferred: string; fallbacks: string[] } | null> {
  let mimeType: string | undefined;
  try {
    mimeType = (await getFileMetadata(env, userId, fileId)).mimeType;
  } catch {
    return null;
  }
  if (!mimeType) return null;

  const preferred = getExportMimeType(mimeType);
  if (!preferred) return null;

  const fallbacks = (getExportMimeTypes(mimeType) || []).filter((mime) => mime !== preferred);
  return { preferred, fallbacks };
}

const driveRoutes = new Hono<{
  Bindings: Env;
  Variables: {
    user?: AccountView;
    session?: AuthenticatedSession;
    requestId: string;
  };
}>();

// All drive routes require active session
driveRoutes.use('*', requireSession);

// GET /folders
driveRoutes.get('/folders', async (c) => {
  const user = c.get('user')!;
  const parentFolderId =
    c.req.query('parentId') ||
    c.req.query('parentFolderId') ||
    c.req.query('folderId');
  const pageSize = c.req.query('pageSize') ? parseInt(c.req.query('pageSize')!, 10) : undefined;
  const pageToken = c.req.query('pageToken');

  try {
    const page = await listFolders(c.env, user.id, {
      parentFolderId,
      pageSize,
      pageToken,
    });
    return c.json(page);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to list folders',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
});

// POST /folders
driveRoutes.post('/folders', requireCsrf, async (c) => {
  const user = c.get('user')!;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid JSON request body',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  const parsed = CreateFolderSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid folder creation parameters',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  try {
    const folder = await createFolder(
      c.env,
      user.id,
      parsed.data.name,
      parsed.data.parentFolderId
    );
    return c.json(folder);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to create folder',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
});

// GET /items
driveRoutes.get('/items', async (c) => {
  const user = c.get('user')!;
  const parentFolderId =
    c.req.query('parentId') ||
    c.req.query('parentFolderId') ||
    c.req.query('folderId');
  const query = c.req.query('query') || c.req.query('q');
  const pageSize = c.req.query('pageSize') ? parseInt(c.req.query('pageSize')!, 10) : undefined;
  const pageToken = c.req.query('pageToken');
  const orderBy = c.req.query('orderBy');

  try {
    const page = await listItems(c.env, user.id, {
      parentFolderId,
      query,
      pageSize,
      pageToken,
      orderBy,
    });
    return c.json(page);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to list items',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
});

// GET /search
driveRoutes.get('/search', async (c) => {
  const user = c.get('user')!;
  const query = c.req.query('q') || '';
  const pageSize = c.req.query('pageSize') ? parseInt(c.req.query('pageSize')!, 10) : undefined;
  const pageToken = c.req.query('pageToken');

  try {
    const page = await searchItems(c.env, user.id, query, { pageSize, pageToken });
    return c.json(page);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to search items',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
});

// GET /shared
driveRoutes.get('/shared', async (c) => {
  const user = c.get('user')!;
  const pageSize = c.req.query('pageSize') ? parseInt(c.req.query('pageSize')!, 10) : undefined;
  const pageToken = c.req.query('pageToken');

  try {
    const page = await listShared(c.env, user.id, { pageSize, pageToken });
    return c.json(page);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to list shared items',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
});

// GET /trash
driveRoutes.get('/trash', async (c) => {
  const user = c.get('user')!;
  const pageSize = c.req.query('pageSize') ? parseInt(c.req.query('pageSize')!, 10) : undefined;
  const pageToken = c.req.query('pageToken');

  try {
    const page = await listTrash(c.env, user.id, { pageSize, pageToken });
    return c.json(page);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to list trash items',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
});

// GET /quota & GET /storage
const handleQuota = async (c: Context<{ Bindings: Env; Variables: { user?: AccountView; session?: AuthenticatedSession; requestId: string } }>) => {
  const user = c.get('user')!;
  try {
    const quota = await getQuota(c.env, user.id);
    return c.json(quota);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to get quota',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
};

driveRoutes.get('/quota', handleQuota);
driveRoutes.get('/storage', handleQuota);

// PATCH /items/:fileId
driveRoutes.patch('/items/:fileId', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const fileId = c.req.param('fileId');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid JSON request body',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  const parsed = UpdateDriveItemSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid item update parameters',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  try {
    const item = await updateItem(c.env, user.id, fileId, {
      name: parsed.data.name,
      addParents: parsed.data.addParentFolderId,
      removeParents: parsed.data.removeParentFolderId,
    });
    return c.json(item);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to update item',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
});

// POST /items/:fileId/trash
driveRoutes.post('/items/:fileId/trash', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const fileId = c.req.param('fileId');

  try {
    const item = await trashItem(c.env, user.id, fileId);
    return c.json(item);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to trash item',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
});

// POST /items/:fileId/restore
driveRoutes.post('/items/:fileId/restore', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const fileId = c.req.param('fileId');

  try {
    const item = await restoreItem(c.env, user.id, fileId);
    return c.json(item);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to restore item',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
});

// DELETE /items/:fileId
driveRoutes.delete('/items/:fileId', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const fileId = c.req.param('fileId');

  try {
    await deleteItemPermanently(c.env, user.id, fileId);
    return c.json({ success: true });
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to delete item',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
});

// POST /trash/empty
driveRoutes.post('/trash/empty', requireCsrf, async (c) => {
  const user = c.get('user')!;
  try {
    await emptyTrash(c.env, user.id);
    return c.json({ success: true });
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to empty trash',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
});

// GET /files/:fileId/download
//
// Serves two different Google endpoints behind one URL. Ordinary files stream from
// alt=media; Google Workspace files have no binary content at all and must go through
// /export with a target format.
//
// `?exportMimeType=` short-circuits the decision, which is the path the in-app viewer
// uses (it asks for application/pdf). Without it we try alt=media first and only consult
// the file's metadata if that fails in a way that suggests the file isn't downloadable —
// so the common case still costs a single upstream call.
driveRoutes.get('/files/:fileId/download', async (c) => {
  const user = c.get('user')!;
  const fileId = c.req.param('fileId');
  const requestedExportMime = c.req.query('exportMimeType');

  try {
    let upstreamRes: Response;

    if (requestedExportMime) {
      upstreamRes = await exportFile(c.env, user.id, fileId, requestedExportMime);
    } else {
      try {
        upstreamRes = await downloadFile(c.env, user.id, fileId);
      } catch (dlErr) {
        // Google answers alt=media on a Workspace file with 403 fileNotDownloadable
        // (and occasionally 400). Anything else — 404, 401, 429, 5xx — is a real
        // failure of this download and must be reported as itself: retrying it as an
        // export would replace the true cause with Google's "not exportable" 403 and
        // send the user chasing a permissions problem they don't have.
        const status = (dlErr as ErrorLike).status;
        if (status !== 403 && status !== 400) throw dlErr;

        const exportMime = await resolveExportMimeType(c.env, user.id, fileId);
        if (!exportMime) throw dlErr;

        upstreamRes = await exportFile(
          c.env,
          user.id,
          fileId,
          exportMime.preferred,
          exportMime.fallbacks
        );
      }
    }

    const headers = new Headers();
    const contentType = upstreamRes.headers.get('Content-Type') || (requestedExportMime || 'application/octet-stream');
    headers.set('Content-Type', contentType);

    const contentLength = upstreamRes.headers.get('Content-Length');
    if (contentLength) headers.set('Content-Length', contentLength);

    const contentDisposition = upstreamRes.headers.get('Content-Disposition');
    if (contentDisposition) {
      headers.set('Content-Disposition', contentDisposition);
    } else if (contentType.includes('pdf')) {
      headers.set('Content-Disposition', 'inline');
    }

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers,
    });
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to download file',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
});

// GET /files/:fileId/permissions
driveRoutes.get('/files/:fileId/permissions', async (c) => {
  const user = c.get('user')!;
  const fileId = c.req.param('fileId');

  try {
    const permissions = await getPermissions(c.env, user.id, fileId);
    return c.json({ permissions });
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to get permissions',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
});

// POST /files/:fileId/permissions
driveRoutes.post('/files/:fileId/permissions', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const fileId = c.req.param('fileId');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid JSON request body',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  const parsed = AddPermissionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid permission parameters',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  try {
    const permission = await addPermission(c.env, user.id, fileId, parsed.data);
    return c.json(permission);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to add permission',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
});

// PATCH /files/:fileId/permissions/:permissionId
driveRoutes.patch('/files/:fileId/permissions/:permissionId', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const fileId = c.req.param('fileId');
  const permissionId = c.req.param('permissionId');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid JSON request body',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  const parsed = UpdatePermissionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid permission update parameters',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  try {
    const permission = await updatePermission(
      c.env,
      user.id,
      fileId,
      permissionId,
      parsed.data.role
    );
    return c.json(permission);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to update permission',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
});

// DELETE /files/:fileId/permissions/:permissionId
driveRoutes.delete('/files/:fileId/permissions/:permissionId', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const fileId = c.req.param('fileId');
  const permissionId = c.req.param('permissionId');

  try {
    await removePermission(c.env, user.id, fileId, permissionId);
    return c.json({ success: true });
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DRIVE_ERROR',
          message: e.message || 'Failed to remove permission',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 401 | 403 | 404 | 429 | 500) || 500
    );
  }
});

export { driveRoutes };
