import { describe, it, expect } from 'vitest';
import { isArchiveFile, getArchiveFolderName } from '../../src/shared/archiveUtils';

describe('archiveUtils', () => {
  describe('isArchiveFile', () => {
    it('detects archives by MIME type', () => {
      expect(isArchiveFile('file', 'application/zip')).toBe(true);
      expect(isArchiveFile('file', 'application/x-zip-compressed')).toBe(true);
      expect(isArchiveFile('file', 'application/x-rar-compressed')).toBe(true);
      expect(isArchiveFile('file', 'application/vnd.rar')).toBe(true);
      expect(isArchiveFile('file', 'application/x-7z-compressed')).toBe(true);
      expect(isArchiveFile('file', 'application/gzip')).toBe(true);
      expect(isArchiveFile('file', 'application/x-tar')).toBe(true);
      expect(isArchiveFile('file', 'application/x-bzip2')).toBe(true);
    });

    it('detects archives by file extension', () => {
      expect(isArchiveFile('photos.zip')).toBe(true);
      expect(isArchiveFile('backup.rar')).toBe(true);
      expect(isArchiveFile('data.7z')).toBe(true);
      expect(isArchiveFile('source.tar.gz')).toBe(true);
      expect(isArchiveFile('archive.tgz')).toBe(true);
      expect(isArchiveFile('system.tar.bz2')).toBe(true);
      expect(isArchiveFile('kernel.xz')).toBe(true);
      expect(isArchiveFile('game.iso')).toBe(true);
      expect(isArchiveFile('app.dmg')).toBe(true);
      expect(isArchiveFile('program.jar')).toBe(true);
      expect(isArchiveFile('split.part01.rar')).toBe(true);
      expect(isArchiveFile('volume.001')).toBe(true);
    });

    it('handles case-insensitivity in extension and MIME', () => {
      expect(isArchiveFile('PHOTOS.ZIP')).toBe(true);
      expect(isArchiveFile('BACKUP.7Z')).toBe(true);
      expect(isArchiveFile('file', 'APPLICATION/ZIP')).toBe(true);
    });

    it('returns false for non-archive files', () => {
      expect(isArchiveFile('movie.mp4', 'video/mp4')).toBe(false);
      expect(isArchiveFile('song.mp3', 'audio/mpeg')).toBe(false);
      expect(isArchiveFile('photo.jpg', 'image/jpeg')).toBe(false);
      expect(isArchiveFile('document.pdf', 'application/pdf')).toBe(false);
      expect(isArchiveFile('notes.txt', 'text/plain')).toBe(false);
      expect(isArchiveFile('spreadsheet.xlsx')).toBe(false);
    });
  });

  describe('getArchiveFolderName', () => {
    it('strips standard archive extensions', () => {
      expect(getArchiveFolderName('photos.zip')).toBe('photos');
      expect(getArchiveFolderName('data.rar')).toBe('data');
      expect(getArchiveFolderName('package.7z')).toBe('package');
      expect(getArchiveFolderName('system.tar')).toBe('system');
    });

    it('strips compound extensions properly', () => {
      expect(getArchiveFolderName('backup.tar.gz')).toBe('backup');
      expect(getArchiveFolderName('source.tar.bz2')).toBe('source');
      expect(getArchiveFolderName('images.tar.xz')).toBe('images');
      expect(getArchiveFolderName('archive.tar.zst')).toBe('archive');
    });

    it('handles multipart archives', () => {
      expect(getArchiveFolderName('collection.part01.rar')).toBe('collection');
      expect(getArchiveFolderName('backup.part1.zip')).toBe('backup');
    });

    it('provides fallback for empty base names', () => {
      expect(getArchiveFolderName('.zip')).toBe('Extracted Archive');
      expect(getArchiveFolderName('.tar.gz')).toBe('Extracted Archive');
    });
  });
});
