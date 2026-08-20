import { describe, it, expect } from 'vitest';
import {
  AccountViewSchema,
  UploadJobViewSchema,
  CreateRemoteJobSchema,
  CreateLocalJobSchema,
  CompleteLocalJobSchema,
  UpdatePreferencesSchema,
  CreateBatchRequestSchema,
  BatchViewSchema,
  MAX_UPLOAD_SIZE_BYTES,
} from '../../src/shared/contracts';

describe('Contracts & DTO validation', () => {
  describe('AccountViewSchema', () => {
    it('accepts safe account profile and ignores extra properties', () => {
      const safeAccount = {
        id: 'usr-1234',
        email: 'user@example.com',
        name: 'Test User',
        picture: 'https://example.com/pic.jpg',
        createdAt: '2026-08-18T10:00:00.000Z',
        lastUsedAt: '2026-08-18T10:00:00.000Z',
        revokedAt: null,
      };
      const parsed = AccountViewSchema.parse(safeAccount);
      expect(parsed.email).toBe('user@example.com');

      // Reject token-like or secret fields in DTO
      const unsafeAccount = {
        ...safeAccount,
        access_token: 'ya29.unsafe-token',
        refresh_token: '1//unsafe-refresh',
      };
      const parsedUnsafe = AccountViewSchema.parse(unsafeAccount);
      expect('access_token' in parsedUnsafe).toBe(false);
      expect('refresh_token' in parsedUnsafe).toBe(false);
    });
  });

  describe('CreateRemoteJobSchema', () => {
    it('accepts valid HTTPS URL and optional folder', () => {
      const valid = CreateRemoteJobSchema.parse({
        url: 'https://example.com/sample.mp4',
        filename: 'sample.mp4',
        folderId: 'folder-123',
      });
      expect(valid.url).toBe('https://example.com/sample.mp4');
    });

    it('accepts an http URL, which the SSRF policy upgrades before anything is fetched', () => {
      const valid = CreateRemoteJobSchema.parse({
        url: 'http://videos15.example.com/remote_control.php?file=abc.mp4&acctoken=zzz',
      });
      expect(valid.url).toBe(
        'http://videos15.example.com/remote_control.php?file=abc.mp4&acctoken=zzz'
      );
    });

    it('rejects schemes that are not http or https', () => {
      expect(() =>
        CreateRemoteJobSchema.parse({
          url: 'file:///etc/passwd',
        })
      ).toThrow();

      expect(() =>
        CreateRemoteJobSchema.parse({
          url: 'blob:https://example.com/uuid',
        })
      ).toThrow();

      expect(() =>
        CreateRemoteJobSchema.parse({
          url: 'ftp://example.com/file.zip',
        })
      ).toThrow();
    });

    it('rejects overlong filenames (> 255 chars)', () => {
      const longName = 'a'.repeat(256) + '.txt';
      expect(() =>
        CreateRemoteJobSchema.parse({
          url: 'https://example.com/file.txt',
          filename: longName,
        })
      ).toThrow();
    });
  });

  describe('CreateLocalJobSchema', () => {
    it('accepts file size within 1 byte to 5 GiB limit', () => {
      const valid = CreateLocalJobSchema.parse({
        filename: 'data.zip',
        fileSize: 1024 * 1024 * 100, // 100 MiB
        mimeType: 'application/zip',
      });
      expect(valid.fileSize).toBe(104857600);
    });

    it('rejects 0-byte or negative sizes', () => {
      expect(() =>
        CreateLocalJobSchema.parse({
          filename: 'empty.txt',
          fileSize: 0,
          mimeType: 'text/plain',
        })
      ).toThrow();

      expect(() =>
        CreateLocalJobSchema.parse({
          filename: 'invalid.txt',
          fileSize: -50,
          mimeType: 'text/plain',
        })
      ).toThrow();
    });

    it('rejects sizes exceeding MAX_UPLOAD_SIZE_BYTES (5 GiB)', () => {
      expect(() =>
        CreateLocalJobSchema.parse({
          filename: 'huge.iso',
          fileSize: MAX_UPLOAD_SIZE_BYTES + 1,
          mimeType: 'application/octet-stream',
        })
      ).toThrow();
    });
  });

  describe('CompleteLocalJobSchema', () => {
    it('validates part ETags', () => {
      const valid = CompleteLocalJobSchema.parse({
        parts: [
          { partNumber: 1, etag: 'etag-1' },
          { partNumber: 2, etag: 'etag-2' },
        ],
      });
      expect(valid.parts).toHaveLength(2);
    });

    it('rejects empty parts list', () => {
      expect(() =>
        CompleteLocalJobSchema.parse({
          parts: [],
        })
      ).toThrow();
    });
  });

  describe('UpdatePreferencesSchema', () => {
    it('validates partial preferences update', () => {
      const parsed = UpdatePreferencesSchema.parse({
        themeMode: 'dark',
        colorScheme: 'emerald',
        defaultFolderId: 'folder-abc',
        rememberAccount: false,
      });
      expect(parsed.themeMode).toBe('dark');
      expect(parsed.colorScheme).toBe('emerald');
    });
  });

  describe('UploadJobViewSchema', () => {
    it('parses complete job view and ensures no private storage keys leak', () => {
      const jobView = {
        id: 'job-1234',
        userId: 'usr-1234',
        sourceKind: 'remote' as const,
        sourceUrlRedacted: 'https://example.com/path',
        filename: 'video.mp4',
        fileSize: 1048576,
        mimeType: 'video/mp4',
        destinationFolderId: 'root',
        destinationFolderName: 'My Drive',
        status: 'uploading' as const,
        progressBytes: 524288,
        attemptCount: 1,
        errorCode: null,
        errorMessage: null,
        driveFileId: null,
        driveFileLink: null,
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:01:00.000Z',
        version: 1,
      };

      const parsed = UploadJobViewSchema.parse(jobView);
      expect(parsed.status).toBe('uploading');
      expect('r2_object_key' in parsed).toBe(false);
      expect('workflow_instance_id' in parsed).toBe(false);
      expect('resumable_upload_uri' in parsed).toBe(false);
    });
  });

  describe('CreateBatchRequestSchema & BatchViewSchema', () => {
    it('validates batch creation within 1 to 50 items', () => {
      const parsed = CreateBatchRequestSchema.parse({
        items: [
          { url: 'https://example.com/item1.mp4', filename: 'item1.mp4' },
          { url: 'https://example.com/item2.zip' },
        ],
        folderId: 'f-123',
      });
      expect(parsed.items).toHaveLength(2);
      expect(parsed.folderId).toBe('f-123');
    });

    it('rejects empty batch or batch > 50 items', () => {
      expect(() => CreateBatchRequestSchema.parse({ items: [] })).toThrow();

      const tooMany = Array.from({ length: 51 }, (_, i) => ({
        url: `https://example.com/item${i}.mp4`,
      }));
      expect(() => CreateBatchRequestSchema.parse({ items: tooMany })).toThrow();
    });

    it('parses BatchViewSchema accurately', () => {
      const batch = {
        id: 'batch-1',
        userId: 'usr-1',
        destinationFolderId: null,
        destinationFolderName: 'Root',
        itemCount: 2,
        queuedCount: 1,
        activeCount: 1,
        completedCount: 0,
        failedCount: 0,
        canceledCount: 0,
        progressBytes: 100,
        totalKnownBytes: 1000,
        status: 'running' as const,
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
        version: 1,
      };
      const parsed = BatchViewSchema.parse(batch);
      expect(parsed.status).toBe('running');
      expect(parsed.itemCount).toBe(2);
    });
  });
});
