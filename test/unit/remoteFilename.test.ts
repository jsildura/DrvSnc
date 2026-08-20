import { describe, it, expect } from 'vitest';
import {
  deriveRemoteFilename,
  guessMimeFromFilename,
} from '../../src/worker/services/remoteFilename';

describe('deriveRemoteFilename', () => {
  it('takes the basename from a path that already names a file', () => {
    expect(deriveRemoteFilename('https://example.com/small.iso')).toBe('small.iso');
    expect(deriveRemoteFilename('https://example.com/get_zip/28748985/Release.zip')).toBe(
      'Release.zip'
    );
    expect(deriveRemoteFilename('https://example.com/a/b/clip.mp4?token=abc#t=10')).toBe('clip.mp4');
  });

  it('percent-decodes the basename', () => {
    expect(deriveRemoteFilename('https://example.com/My%20Movie%20(2024).mkv')).toBe(
      'My Movie (2024).mkv'
    );
  });

  it('recovers the filename from a query parameter when the path is a delivery script', () => {
    expect(deriveRemoteFilename('https://example.com/download.php?file=clip.mp4')).toBe('clip.mp4');
    expect(deriveRemoteFilename('https://example.com/dl.cgi?id=7&name=archive.zip')).toBe(
      'archive.zip'
    );
    expect(deriveRemoteFilename('https://example.com/get.aspx?path=/media/2024/show.mkv')).toBe(
      'show.mkv'
    );
  });

  it('keeps only the extension when the query value is an access token', () => {
    // The shape of a token-protected progressive-download link: the `file=` value is a signed
    // 200-character blob that happens to end in `.mp4`, which makes a far worse name than the
    // endpoint's own.
    const token = `${'R8cOl0GU0HGcB0AC3ezd'.repeat(5)}_uFD2K9m2SW`;
    const url = `https://videos15.example.com/remote_control.php?file=${token}.mp4&acctoken=ZWRmZGRi`;
    expect(deriveRemoteFilename(url)).toBe('remote_control.mp4');
  });

  it('ignores query values whose extension means nothing', () => {
    expect(deriveRemoteFilename('https://example.com/stream.php?host=cdn.example.com')).toBe(
      'stream.php'
    );
    expect(deriveRemoteFilename('https://example.com/stream.php?ref=index.html')).toBe(
      'stream.php'
    );
  });

  it('falls back to the path when no parameter names a file', () => {
    expect(deriveRemoteFilename('https://example.com/download.php')).toBe('download.php');
    expect(deriveRemoteFilename('https://example.com/')).toBe('remote-download');
    expect(deriveRemoteFilename('not-a-url')).toBe('remote-download');
  });

  it('strips path separators and characters Drive cannot store', () => {
    expect(deriveRemoteFilename('https://example.com/get.php?file=a%3Ab%2Ac.mp4')).toBe(
      'a_b_c.mp4'
    );
    // A leading dot would hide the file, and '..' would be read as a path segment.
    expect(deriveRemoteFilename('https://example.com/get.php?file=..%2Fsecret.mp4')).toBe(
      'secret.mp4'
    );
  });

  it('keeps a playlist URL recognisable as a playlist', () => {
    expect(deriveRemoteFilename('https://example.com/live/master.m3u8?wmsAuthSign=abc')).toBe(
      'master.m3u8'
    );
  });
});

describe('guessMimeFromFilename', () => {
  it('maps media extensions to the type Drive needs for preview', () => {
    expect(guessMimeFromFilename('remote_control.mp4')).toBe('video/mp4');
    expect(guessMimeFromFilename('show.MKV')).toBe('video/x-matroska');
    expect(guessMimeFromFilename('segment.ts')).toBe('video/mp2t');
    expect(guessMimeFromFilename('song.mp3')).toBe('audio/mpeg');
    expect(guessMimeFromFilename('Release.zip')).toBe('application/zip');
    expect(guessMimeFromFilename('master.m3u8')).toBe('application/vnd.apple.mpegurl');
  });

  it('returns null when the extension says nothing', () => {
    expect(guessMimeFromFilename('remote-download')).toBeNull();
    expect(guessMimeFromFilename('download.php')).toBeNull();
    expect(guessMimeFromFilename('archive.tar.xz')).toBeNull();
    expect(guessMimeFromFilename('')).toBeNull();
  });
});
