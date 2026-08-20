import { describe, it, expect } from 'vitest';
import {
  isHlsUrl,
  parsePlaylist,
  selectVariant,
  deriveHlsBaseName,
  deriveHlsFilename,
  hlsMimeType,
  HlsError,
  HlsMasterPlaylist,
  HlsMediaPlaylist,
} from '../../src/worker/services/hlsPlaylist';

// The two fixtures below are the real bodies served by the URL that prompted this feature: a
// 183-byte master playlist and the live variant it points at.
const MASTER_URL =
  'https://hls-harbor-livepush.akamaized.net/live_cdn/nsqIStpj8PaG-Ev/emcQJ0pGpremocy/index.m3u8';

const MASTER_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=4970000,RESOLUTION=1920x1080,CODECS="avc1.4d4028,mp4a.40.2"
tracks-v1a1/mono.m3u8
`;

const LIVE_VARIANT_URL =
  'https://hls-harbor-livepush.akamaized.net/live_cdn/nsqIStpj8PaG-Ev/emcQJ0pGpremocy/tracks-v1a1/mono.m3u8';

const LIVE_VARIANT = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:5
#EXT-X-MEDIA-SEQUENCE:1025763
#EXTINF:5.000,
segment-1025763.ts
#EXTINF:5.000,
segment-1025764.ts
#EXTINF:5.000,
segment-1025765.ts
#EXTINF:5.000,
segment-1025766.ts
`;

function asMedia(playlist: ReturnType<typeof parsePlaylist>): HlsMediaPlaylist {
  if (playlist.kind !== 'media') throw new Error('expected a media playlist');
  return playlist;
}

function asMaster(playlist: ReturnType<typeof parsePlaylist>): HlsMasterPlaylist {
  if (playlist.kind !== 'master') throw new Error('expected a master playlist');
  return playlist;
}

describe('isHlsUrl', () => {
  it('recognises a playlist by path extension', () => {
    expect(isHlsUrl(MASTER_URL)).toBe(true);
    expect(isHlsUrl('https://example.com/live/stream.m3u')).toBe(true);
    expect(isHlsUrl('https://example.com/archive.zip')).toBe(false);
  });

  it('recognises a playlist whose extension is hidden behind a query string', () => {
    // Signed CDN URLs routinely look like this, so the content type has to carry the decision.
    expect(isHlsUrl('https://example.com/play?id=42', 'application/x-mpegURL')).toBe(true);
    expect(isHlsUrl('https://example.com/play?id=42', 'application/vnd.apple.mpegurl; charset=utf-8')).toBe(
      true
    );
    expect(isHlsUrl('https://example.com/play?id=42', 'video/mp4')).toBe(false);
  });

  it('does not treat an unparseable string as a playlist', () => {
    expect(isHlsUrl('')).toBe(false);
    expect(isHlsUrl('not a url')).toBe(false);
  });
});

describe('parsePlaylist', () => {
  it('reads a master playlist as its variant list', () => {
    const master = asMaster(parsePlaylist(MASTER_PLAYLIST, MASTER_URL));

    expect(master.variants).toHaveLength(1);
    expect(master.variants[0]).toMatchObject({
      url: LIVE_VARIANT_URL,
      bandwidth: 4970000,
      resolution: '1920x1080',
      codecs: 'avc1.4d4028,mp4a.40.2',
    });
  });

  it('resolves relative segment URIs against the variant URL, not the master URL', () => {
    const media = asMedia(parsePlaylist(LIVE_VARIANT, LIVE_VARIANT_URL));

    expect(media.segments[0].url).toBe(
      'https://hls-harbor-livepush.akamaized.net/live_cdn/nsqIStpj8PaG-Ev/emcQJ0pGpremocy/tracks-v1a1/segment-1025763.ts'
    );
  });

  it('numbers segments from EXT-X-MEDIA-SEQUENCE so a live cursor survives a rolling window', () => {
    const media = asMedia(parsePlaylist(LIVE_VARIANT, LIVE_VARIANT_URL));

    expect(media.mediaSequence).toBe(1025763);
    expect(media.segments.map((s) => s.sequence)).toEqual([1025763, 1025764, 1025765, 1025766]);
    expect(media.segments.every((s) => s.duration === 5)).toBe(true);
  });

  it('treats a missing EXT-X-ENDLIST as live and a present one as complete', () => {
    expect(asMedia(parsePlaylist(LIVE_VARIANT, LIVE_VARIANT_URL)).isLive).toBe(true);
    expect(asMedia(parsePlaylist(`${LIVE_VARIANT}#EXT-X-ENDLIST\n`, LIVE_VARIANT_URL)).isLive).toBe(
      false
    );
  });

  it('defaults TARGETDURATION when the playlist omits it', () => {
    const media = asMedia(
      parsePlaylist('#EXTM3U\n#EXTINF:4.0,\na.ts\n#EXT-X-ENDLIST\n', LIVE_VARIANT_URL)
    );
    expect(media.targetDuration).toBe(6);
  });

  it('reads an EXT-X-MAP init segment and switches the container to fMP4', () => {
    const fmp4 = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4.0,
seg-0.m4s
#EXT-X-ENDLIST
`;
    const media = asMedia(parsePlaylist(fmp4, 'https://cdn.example.com/v/index.m3u8'));

    expect(media.container).toBe('fmp4');
    expect(media.initSegment?.url).toBe('https://cdn.example.com/v/init.mp4');
    expect(hlsMimeType(media.container)).toBe('video/mp4');
  });

  it('detects fMP4 from the segment extension even without an init segment', () => {
    const media = asMedia(
      parsePlaylist('#EXTM3U\n#EXTINF:4.0,\nseg-0.m4s\n#EXT-X-ENDLIST\n', LIVE_VARIANT_URL)
    );
    expect(media.container).toBe('fmp4');
  });

  it('defaults to MPEG-TS, which concatenates into a playable .ts file', () => {
    const media = asMedia(parsePlaylist(LIVE_VARIANT, LIVE_VARIANT_URL));
    expect(media.container).toBe('mpegts');
    expect(hlsMimeType(media.container)).toBe('video/mp2t');
  });

  it('carries a byte-range offset forward when the tag omits it', () => {
    const ranged = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-BYTERANGE:1000@0
#EXTINF:4.0,
all.ts
#EXT-X-BYTERANGE:2000
#EXTINF:4.0,
all.ts
#EXT-X-ENDLIST
`;
    const media = asMedia(parsePlaylist(ranged, LIVE_VARIANT_URL));

    expect(media.segments[0].byteRange).toEqual({ offset: 0, length: 1000 });
    expect(media.segments[1].byteRange).toEqual({ offset: 1000, length: 2000 });
  });

  it('attaches an AES-128 key to every segment in its run', () => {
    const encrypted = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x000102030405060708090A0B0C0D0E0F
#EXTINF:4.0,
a.ts
#EXTINF:4.0,
b.ts
#EXT-X-ENDLIST
`;
    const media = asMedia(parsePlaylist(encrypted, 'https://cdn.example.com/v/index.m3u8'));

    expect(media.segments[0].key?.url).toBe('https://cdn.example.com/v/key.bin');
    expect(media.segments[1].key?.url).toBe('https://cdn.example.com/v/key.bin');
    expect(Array.from(media.segments[0].key?.iv ?? [])).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
  });

  it('ends an encrypted run on METHOD=NONE', () => {
    const mixed = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:4.0,
a.ts
#EXT-X-KEY:METHOD=NONE
#EXTINF:4.0,
b.ts
#EXT-X-ENDLIST
`;
    const media = asMedia(parsePlaylist(mixed, 'https://cdn.example.com/v/index.m3u8'));

    expect(media.segments[0].key).not.toBeNull();
    expect(media.segments[1].key).toBeNull();
  });

  it('refuses SAMPLE-AES rather than uploading undecryptable bytes', () => {
    const sampleAes = `#EXTM3U
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key.bin"
#EXTINF:4.0,
a.ts
#EXT-X-ENDLIST
`;
    expect(() => parsePlaylist(sampleAes, LIVE_VARIANT_URL)).toThrowError(
      expect.objectContaining({ code: 'HLS_ENCRYPTION_UNSUPPORTED' })
    );
  });

  it('refuses a DRM key format', () => {
    const drm = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="skd://abc",KEYFORMAT="com.apple.streamingkeydelivery"
#EXTINF:4.0,
a.ts
#EXT-X-ENDLIST
`;
    expect(() => parsePlaylist(drm, LIVE_VARIANT_URL)).toThrowError(
      expect.objectContaining({ code: 'HLS_ENCRYPTION_UNSUPPORTED' })
    );
  });

  it('rejects a body that is not a playlist at all', () => {
    expect(() => parsePlaylist('<html>404</html>', LIVE_VARIANT_URL)).toThrowError(HlsError);
    expect(() => parsePlaylist('<html>404</html>', LIVE_VARIANT_URL)).toThrowError(
      expect.objectContaining({ code: 'HLS_INVALID_PLAYLIST' })
    );
  });

  it('rejects a playlist with neither segments nor variants', () => {
    expect(() => parsePlaylist('#EXTM3U\n#EXT-X-VERSION:3\n', LIVE_VARIANT_URL)).toThrowError(
      expect.objectContaining({ code: 'HLS_EMPTY_PLAYLIST' })
    );
  });
});

describe('selectVariant', () => {
  it('picks the highest advertised bandwidth', () => {
    const master = asMaster(
      parsePlaylist(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4970000,RESOLUTION=1920x1080
high.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720
mid.m3u8
`,
        'https://cdn.example.com/v/index.m3u8'
      )
    );

    expect(selectVariant(master.variants).url).toBe('https://cdn.example.com/v/high.m3u8');
  });

  it('throws when there is nothing to select', () => {
    expect(() => selectVariant([])).toThrowError(
      expect.objectContaining({ code: 'HLS_NO_VARIANTS' })
    );
  });
});

describe('deriveHlsBaseName', () => {
  it('walks past a boilerplate playlist name to the identifying path segment', () => {
    // Naming the file `index` would tell the user nothing about what they recorded.
    expect(deriveHlsBaseName(MASTER_URL)).toBe('emcQJ0pGpremocy');
    expect(deriveHlsBaseName(LIVE_VARIANT_URL)).toBe('tracks-v1a1');
    expect(deriveHlsBaseName('https://cdn.example.com/a/b/master.m3u8')).toBe('b');
  });

  it('keeps a playlist name that is already meaningful', () => {
    expect(deriveHlsBaseName('https://cdn.example.com/vod/big-buck-bunny.m3u8')).toBe(
      'big-buck-bunny'
    );
  });

  it('falls back when the path holds nothing usable', () => {
    expect(deriveHlsBaseName('https://cdn.example.com/index.m3u8')).toBe('hls-stream');
  });
});

describe('deriveHlsFilename', () => {
  it('uses the container extension, never .m3u8', () => {
    expect(deriveHlsFilename(MASTER_URL, 'mpegts')).toBe('emcQJ0pGpremocy.ts');
    expect(deriveHlsFilename(MASTER_URL, 'fmp4')).toBe('emcQJ0pGpremocy.mp4');
  });

  it('stamps a recording so repeat captures of one live stream stay distinct', () => {
    const name = deriveHlsFilename(MASTER_URL, 'mpegts', new Date('2026-08-20T09:15:30.123Z'));
    expect(name).toBe('emcQJ0pGpremocy_2026-08-20T09-15-30Z.ts');
  });
});
