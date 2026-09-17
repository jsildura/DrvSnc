import { describe, it, expect } from 'vitest';
import {
  escapeQueryString,
  getExportMimeType,
  normalizeDriveItem,
  mapDriveError,
} from '../../src/worker/services/driveClient';

describe('Drive Client Utilities & Normalization', () => {
  it('properly escapes special characters in query strings', () => {
    const singleQuote = escapeQueryString("Project's Documents \\ 2026");
    expect(singleQuote).toBe("Project\\'s Documents \\\\ 2026");
  });

  it('maps Google Workspace document MIME types to standard export formats', () => {
    expect(getExportMimeType('application/vnd.google-apps.document', 'application/pdf')).toBe(
      'application/pdf'
    );
    expect(getExportMimeType('application/vnd.google-apps.spreadsheet', 'text/csv')).toBe(
      'text/csv'
    );
    // Defaults to PDF for docs when unspecified
    expect(getExportMimeType('application/vnd.google-apps.document')).toBe('application/pdf');
    // Non-workspace type returns null
    expect(getExportMimeType('image/png')).toBeNull();
  });

  it('normalizes raw Google Drive file objects to safe DriveItemView', () => {
    const rawGoogleFile = {
      id: 'file-12345',
      name: 'Financial Report.pdf',
      mimeType: 'application/pdf',
      size: '1048576',
      modifiedTime: '2026-08-18T10:00:00.000Z',
      createdTime: '2026-08-18T09:00:00.000Z',
      shared: true,
      trashed: false,
      iconLink: 'https://example.com/icon.png',
      thumbnailLink: 'https://example.com/thumb.png',
      webViewLink: 'https://drive.google.com/file/d/file-12345/view',
      owners: [{ displayName: 'Alice', emailAddress: 'alice@example.com' }],
      parents: ['folder-root'],
    };

    const item = normalizeDriveItem(rawGoogleFile);
    expect(item.id).toBe('file-12345');
    expect(item.name).toBe('Financial Report.pdf');
    expect(item.isFolder).toBe(false);
    expect(item.size).toBe(1048576);
    expect(item.shared).toBe(true);
    expect(item.trashed).toBe(false);
    expect(item.owners?.[0].displayName).toBe('Alice');
  });

  it('detects folders correctly during normalization', () => {
    const rawFolder = {
      id: 'folder-999',
      name: 'My Backups',
      mimeType: 'application/vnd.google-apps.folder',
      shared: false,
      trashed: false,
    };

    const item = normalizeDriveItem(rawFolder);
    expect(item.isFolder).toBe(true);
    expect(item.size).toBeNull();
  });

  it('detects folder shortcuts and normalizes them as folders with targetId', () => {
    const rawFolderShortcut = {
      id: 'shortcut-111',
      name: 'Shared Team Drive Folder',
      mimeType: 'application/vnd.google-apps.shortcut',
      shared: true,
      trashed: false,
      shortcutDetails: {
        targetId: 'target-folder-888',
        targetMimeType: 'application/vnd.google-apps.folder',
      },
    };

    const item = normalizeDriveItem(rawFolderShortcut);
    expect(item.id).toBe('shortcut-111');
    expect(item.isFolder).toBe(true);
    expect(item.isShortcut).toBe(true);
    expect(item.targetId).toBe('target-folder-888');
    expect(item.targetMimeType).toBe('application/vnd.google-apps.folder');
    expect(item.size).toBeNull();
  });

  it('detects file shortcuts and does not mark them as folders', () => {
    const rawFileShortcut = {
      id: 'shortcut-222',
      name: 'Shared Document Shortcut',
      mimeType: 'application/vnd.google-apps.shortcut',
      shared: true,
      trashed: false,
      shortcutDetails: {
        targetId: 'target-doc-999',
        targetMimeType: 'application/pdf',
      },
    };

    const item = normalizeDriveItem(rawFileShortcut);
    expect(item.id).toBe('shortcut-222');
    expect(item.isFolder).toBe(false);
    expect(item.isShortcut).toBe(true);
    expect(item.targetId).toBe('target-doc-999');
  });

  it('maps Google HTTP errors to stable internal error codes without leaking raw bodies', () => {
    const error401 = mapDriveError(401, 'Unauthorized');
    expect(error401.code).toBe('DRIVE_UNAUTHORIZED');

    const error403 = mapDriveError(403, 'The user does not have sufficient permissions for file file-123');
    expect(error403.code).toBe('DRIVE_FORBIDDEN');
    expect(error403.message).toBe('Permission denied on Google Drive resource');
    expect(error403.retriable).toBe(false);

    const error404 = mapDriveError(404, 'File not found');
    expect(error404.code).toBe('DRIVE_NOT_FOUND');

    const error429 = mapDriveError(429, 'Rate limit exceeded');
    expect(error429.code).toBe('DRIVE_RATE_LIMIT_EXCEEDED');
    expect(error429.retriable).toBe(true);
  });

  it('correctly classifies 403 rate limit reasons as retriable rate limits', () => {
    const throttleReasons = [
      'userRateLimitExceeded',
      'rateLimitExceeded',
      'dailyLimitExceeded',
      'sharingRateLimitExceeded',
      'backendError',
      'internalError',
    ];

    for (const reason of throttleReasons) {
      const mapped = mapDriveError(403, reason);
      expect(mapped.code).toBe('DRIVE_RATE_LIMIT_EXCEEDED');
      expect(mapped.retriable).toBe(true);
      expect(mapped.message).toContain('rate limit reached');
    }

    // A genuine permission denial reason remains non-retriable DRIVE_FORBIDDEN
    const forbidden = mapDriveError(403, 'insufficientFilePermissions');
    expect(forbidden.code).toBe('DRIVE_FORBIDDEN');
    expect(forbidden.retriable).toBe(false);

    // Bare 403 without reason also defaults to DRIVE_FORBIDDEN
    const bareForbidden = mapDriveError(403);
    expect(bareForbidden.code).toBe('DRIVE_FORBIDDEN');
    expect(bareForbidden.retriable).toBe(false);
  });
});
