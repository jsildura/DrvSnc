import { ARCHIVE_EXTENSIONS, ARCHIVE_MIME_TYPES } from './contracts';

/**
 * Determines whether a file is an extractable archive based on its name and/or MIME type.
 */
export function isArchiveFile(name: string, mimeType?: string): boolean {
  const lowerName = (name || '').toLowerCase();
  const lowerMime = (mimeType || '').toLowerCase();

  // Check MIME type match
  if (lowerMime && ARCHIVE_MIME_TYPES.some((m) => lowerMime === m || lowerMime.includes(m))) {
    return true;
  }

  // Common generic compressed mime types or zip in mime
  if (
    lowerMime.includes('zip') ||
    lowerMime.includes('tar') ||
    lowerMime.includes('rar') ||
    lowerMime.includes('7z') ||
    lowerMime.includes('compressed')
  ) {
    return true;
  }

  // Check file extension match
  for (const ext of ARCHIVE_EXTENSIONS) {
    if (lowerName.endsWith(ext)) {
      return true;
    }
  }

  // Match multi-part archives like .part1.rar or .z01, .r00
  if (/\.(part\d+\.rar|r\d{2}|z\d{2}|00\d)$/i.test(lowerName)) {
    return true;
  }

  return false;
}

/**
 * Derives a clean folder name for extracted contents from an archive filename.
 * e.g., "archive.zip" -> "archive"
 *       "project.tar.gz" -> "project"
 *       "data.part01.rar" -> "data"
 */
export function getArchiveFolderName(archiveFilename: string): string {
  let base = archiveFilename.trim();

  // Remove multi-part suffixes like .part01, .part1
  base = base.replace(/\.part\d+(\.[a-zA-Z0-9]+)$/i, '$1');

  // Handle common compound extensions (.tar.gz, .tar.bz2, .tar.xz)
  const compoundExtensions = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst'];
  for (const ext of compoundExtensions) {
    if (base.toLowerCase().endsWith(ext)) {
      return base.slice(0, -ext.length) || 'Extracted Archive';
    }
  }

  // Remove trailing extension
  const lastDot = base.lastIndexOf('.');
  if (lastDot > 0) {
    base = base.substring(0, lastDot);
  } else if (lastDot === 0) {
    base = '';
  }

  return base || 'Extracted Archive';
}
