import { Hono, Context } from 'hono';
import { Env } from '../env';
import { requireSession, AuthenticatedSession } from '../middleware/session';
import { requireCsrf } from '../middleware/csrf';
import {
  AccountView,
  PreferencesView,
  UpdatePreferencesSchema,
} from '../../shared/contracts';

const preferencesRoutes = new Hono<{
  Bindings: Env;
  Variables: {
    user?: AccountView;
    session?: AuthenticatedSession;
    requestId: string;
  };
}>();

preferencesRoutes.get('/', requireSession, async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication session required',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      401
    );
  }

  const userId = user.id;

  try {
    const row = await c.env.DB.prepare(
      `SELECT theme_mode, color_scheme, filename_pattern, notifications_enabled,
              default_folder_id, default_folder_name, remember_account, updated_at
       FROM preferences
       WHERE user_id = ?`
    )
      .bind(userId)
      .first<{
        theme_mode: 'light' | 'dark' | 'system';
        color_scheme: string;
        filename_pattern: string;
        notifications_enabled: number;
        default_folder_id: string | null;
        default_folder_name: string | null;
        remember_account: number;
        updated_at: string;
      }>();

    if (row) {
      const preferences: PreferencesView = {
        themeMode: row.theme_mode,
        colorScheme: row.color_scheme,
        filenamePattern: row.filename_pattern,
        notificationsEnabled: Boolean(row.notifications_enabled),
        defaultFolderId: row.default_folder_id,
        defaultFolderName: row.default_folder_name,
        rememberAccount: Boolean(row.remember_account),
        updatedAt: row.updated_at,
      };
      return c.json(preferences);
    }
  } catch (err) {
    console.error('Error fetching preferences:', err);
  }

  const defaultPreferences: PreferencesView = {
    themeMode: 'light',
    colorScheme: 'drive',
    filenamePattern: '{filename}',
    notificationsEnabled: true,
    defaultFolderId: null,
    defaultFolderName: null,
    rememberAccount: true,
    updatedAt: new Date().toISOString(),
  };

  return c.json(defaultPreferences);
});

async function handleUpdatePreferences(c: Context<{
  Bindings: Env;
  Variables: {
    user?: AccountView;
    session?: AuthenticatedSession;
    requestId: string;
  };
}>) {
  const user = c.get('user')!;
  const userId = user.id;

  let body;
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

  const parseResult = UpdatePreferencesSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid preferences payload',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  const updates = parseResult.data;

  // Retrieve current or create default
  let existing = null;
  try {
    existing = await c.env.DB.prepare(
      `SELECT theme_mode, color_scheme, filename_pattern, notifications_enabled,
              default_folder_id, default_folder_name, remember_account
       FROM preferences
       WHERE user_id = ?`
    )
      .bind(userId)
      .first<{
        theme_mode: 'light' | 'dark' | 'system';
        color_scheme: string;
        filename_pattern: string;
        notifications_enabled: number;
        default_folder_id: string | null;
        default_folder_name: string | null;
        remember_account: number;
      }>();
  } catch {
    // ignore
  }

  const themeMode = updates.themeMode ?? existing?.theme_mode ?? 'light';
  const colorScheme = updates.colorScheme ?? existing?.color_scheme ?? 'drive';
  const filenamePattern = updates.filenamePattern ?? existing?.filename_pattern ?? '{filename}';
  const notificationsEnabled = updates.notificationsEnabled !== undefined
    ? updates.notificationsEnabled
    : existing ? Boolean(existing.notifications_enabled) : true;
  const defaultFolderId = updates.defaultFolderId !== undefined
    ? updates.defaultFolderId
    : (existing?.default_folder_id ?? null);
  const defaultFolderName = updates.defaultFolderName !== undefined
    ? updates.defaultFolderName
    : (existing?.default_folder_name ?? null);
  const rememberAccount = updates.rememberAccount !== undefined
    ? updates.rememberAccount
    : existing ? Boolean(existing.remember_account) : true;

  const row = await c.env.DB.prepare(
    `INSERT INTO preferences (
       user_id, theme_mode, color_scheme, filename_pattern, notifications_enabled,
       default_folder_id, default_folder_name, remember_account, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT (user_id) DO UPDATE SET
       theme_mode = excluded.theme_mode,
       color_scheme = excluded.color_scheme,
       filename_pattern = excluded.filename_pattern,
       notifications_enabled = excluded.notifications_enabled,
       default_folder_id = excluded.default_folder_id,
       default_folder_name = excluded.default_folder_name,
       remember_account = excluded.remember_account,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     RETURNING theme_mode, color_scheme, filename_pattern, notifications_enabled,
               default_folder_id, default_folder_name, remember_account, updated_at`
  )
    .bind(
      userId,
      themeMode,
      colorScheme,
      filenamePattern,
      notificationsEnabled ? 1 : 0,
      defaultFolderId,
      defaultFolderName,
      rememberAccount ? 1 : 0
    )
    .first<{
      theme_mode: 'light' | 'dark' | 'system';
      color_scheme: string;
      filename_pattern: string;
      notifications_enabled: number;
      default_folder_id: string | null;
      default_folder_name: string | null;
      remember_account: number;
      updated_at: string;
    }>();

  const response: PreferencesView = {
    themeMode: row!.theme_mode,
    colorScheme: row!.color_scheme,
    filenamePattern: row!.filename_pattern,
    notificationsEnabled: Boolean(row!.notifications_enabled),
    defaultFolderId: row!.default_folder_id,
    defaultFolderName: row!.default_folder_name,
    rememberAccount: Boolean(row!.remember_account),
    updatedAt: row!.updated_at,
  };

  return c.json(response);
}

// Support both PUT and PATCH for updating preferences
preferencesRoutes.put('/', requireSession, requireCsrf, handleUpdatePreferences);
preferencesRoutes.patch('/', requireSession, requireCsrf, handleUpdatePreferences);

export { preferencesRoutes };
