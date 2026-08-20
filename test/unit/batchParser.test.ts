import { describe, it, expect } from 'vitest';
import { parseBatchText, parseBatchFile } from '../../src/web/uploads/batchParser';

describe('batchParser', () => {
  it('parses valid URLs with mixed LF and CRLF and whitespace', () => {
    const text = `
      https://example.com/file1.mp4\r\n
      https://example.com/file2.zip
      
      https://cdn.example.org/path/to/archive.tar.gz  \n
    `;

    const res = parseBatchText(text);
    expect(res.error).toBeUndefined();
    expect(res.items).toHaveLength(3);
    expect(res.items[0].url).toBe('https://example.com/file1.mp4');
    expect(res.items[0].filename).toBe('file1.mp4');
    expect(res.items[1].url).toBe('https://example.com/file2.zip');
    expect(res.items[1].filename).toBe('file2.zip');
    expect(res.items[2].url).toBe('https://cdn.example.org/path/to/archive.tar.gz');
    expect(res.items[2].filename).toBe('archive.tar.gz');
    expect(res.duplicateLines).toHaveLength(0);
    expect(res.invalidLines).toHaveLength(0);
  });

  it('detects duplicate URLs and keeps first-seen order', () => {
    const text = `
https://example.com/file1.mp4
https://example.com/file2.zip
https://example.com/file1.mp4
https://example.com/file2.zip
`;

    const res = parseBatchText(text);
    expect(res.items).toHaveLength(2);
    expect(res.duplicateLines).toHaveLength(2);
    expect(res.duplicateLines[0]).toEqual({
      line: 4,
      duplicateOf: 2,
      url: 'https://example.com/file1.mp4',
    });
  });

  it('identifies malformed URLs and blocked hosts', () => {
    const text = `
https://valid.com/video.mp4
not-a-url
https://127.0.0.1/private.zip
ftp://files.example.com/video.mp4
`;

    const res = parseBatchText(text);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].url).toBe('https://valid.com/video.mp4');
    expect(res.invalidLines).toHaveLength(3);
    expect(res.invalidLines[0].line).toBe(3);
    expect(res.invalidLines[0].reason).toContain('Malformed');
  });

  it('upgrades http lines to https instead of discarding them', () => {
    const text = `
http://insecure.com/video.mp4
https://insecure.com/video.mp4
`;

    const res = parseBatchText(text);
    expect(res.invalidLines).toHaveLength(0);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].url).toBe('https://insecure.com/video.mp4');
    // The upgrade happens before de-duplication, so the same file pasted under both
    // schemes is one item rather than two uploads of the same video.
    expect(res.duplicateLines).toHaveLength(1);
    expect(res.duplicateLines[0].duplicateOf).toBe(2);
  });

  it('errors when exceeding MAX_BATCH_URLS (50)', () => {
    const urls = Array.from({ length: 51 }, (_, i) => `https://example.com/item-${i}.mp4`).join('\n');
    const res = parseBatchText(urls);
    expect(res.error).toContain('Exceeded maximum of 50 URLs');
    expect(res.items).toHaveLength(51);
  });

  it('parses UTF-8 text file via parseBatchFile', async () => {
    const content = 'https://example.com/file1.mp4\nhttps://example.com/file2.mp4';
    const file = new File([content], 'batch.txt', { type: 'text/plain' });

    const res = await parseBatchFile(file);
    expect(res.error).toBeUndefined();
    expect(res.items).toHaveLength(2);
  });

  it('rejects unsupported file extensions or empty files', async () => {
    const emptyFile = new File([], 'empty.txt', { type: 'text/plain' });
    const resEmpty = await parseBatchFile(emptyFile);
    expect(resEmpty.error).toBe('Uploaded file is empty');

    const pdfFile = new File(['content'], 'document.pdf', { type: 'application/pdf' });
    const resPdf = await parseBatchFile(pdfFile);
    expect(resPdf.error).toContain('Only .txt');
  });
});
