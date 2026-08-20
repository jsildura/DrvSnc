import { describe, it, expect } from 'vitest';
import { fetchSourceInBrowser, RelayError } from '../../src/web/uploads/relayFetch';

function bodyResponse(bytes: number, headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers });
}

/** Records the init the driver passed, which is where the CORS-safety decisions show up. */
function recordingFetch(response: Response | (() => never)) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (typeof response === 'function') response();
    return response;
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

const signUrl = 'https://cdn.example.com/clip.mp4';

/** Asserts the fetch was rejected and hands back the classified error. */
async function relayErrorFrom(promise: Promise<unknown>): Promise<RelayError> {
  try {
    await promise;
  } catch (err) {
    return err as RelayError;
  }
  throw new Error('Expected fetchSourceInBrowser to reject');
}

describe('Browser-side source fetch (relay leg 1)', () => {
  it('reads the body, size and bare content type from a plain streaming GET', async () => {
    const { calls, fetchFn } = recordingFetch(
      bodyResponse(64, { 'Content-Length': '64', 'Content-Type': 'video/mp4; charset=binary' })
    );

    const source = await fetchSourceInBrowser('https://cdn.example.com/clip.mp4?t=1', undefined, fetchFn);

    expect(source.size).toBe(64);
    // Drive keys preview behaviour off the type, so the charset parameter must not ride along.
    expect(source.contentType).toBe('video/mp4');

    const read = await new Response(source.stream).arrayBuffer();
    expect(read.byteLength).toBe(64);

    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe('GET');
    // A ranged read would need an OPTIONS preflight most delivery endpoints ignore, and
    // Content-Range is not a CORS-safelisted response header anyway.
    expect(new Headers(calls[0].init?.headers as HeadersInit | undefined).get('Range')).toBeNull();
    expect(calls[0].init?.credentials).toBe('omit');
    expect(calls[0].init?.referrerPolicy).toBe('no-referrer');
    // An opaque response's bytes cannot be read, so no-cors would defeat the purpose.
    expect(calls[0].init?.mode).toBeUndefined();
  });

  it('reports zero size when the source declares no Content-Length', async () => {
    const { fetchFn } = recordingFetch(bodyResponse(8, { 'Content-Type': 'video/mp4' }));

    const source = await fetchSourceInBrowser('https://cdn.example.com/clip.mp4', undefined, fetchFn);

    expect(source.size).toBe(0);
    await source.stream.cancel();
  });

  it('classifies an opaque fetch rejection as a CORS block', async () => {
    const { fetchFn } = recordingFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    const err = await relayErrorFrom(fetchSourceInBrowser(signUrl, undefined, fetchFn));

    expect(err).toBeInstanceOf(RelayError);
    expect(err.code).toBe('RELAY_CORS_BLOCKED');
    expect(err.message).toContain('Access-Control-Allow-Origin');
  });

  it('reports a canceled fetch as an abort rather than a CORS block', async () => {
    const controller = new AbortController();
    controller.abort();

    const { fetchFn } = recordingFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    const err = await relayErrorFrom(fetchSourceInBrowser(signUrl, controller.signal, fetchFn));

    expect(err.code).toBe('RELAY_ABORTED');
  });

  it.each([401, 403])('treats HTTP %i as an expired or wrong-IP link', async (status) => {
    const { fetchFn } = recordingFetch(new Response('denied', { status }));

    const err = await relayErrorFrom(fetchSourceInBrowser(signUrl, undefined, fetchFn));

    expect(err.code).toBe('RELAY_SOURCE_DENIED');
    expect(err.status).toBe(status);
    expect(err.message).toContain('IP address');
  });

  it('separates a server-side failure from an authorization failure', async () => {
    const { fetchFn } = recordingFetch(new Response('boom', { status: 500 }));

    const err = await relayErrorFrom(fetchSourceInBrowser(signUrl, undefined, fetchFn));

    expect(err.code).toBe('RELAY_SOURCE_HTTP_ERROR');
    expect(err.status).toBe(500);
  });

  it('refuses a source that declares more than the 5 GiB maximum', async () => {
    const { fetchFn } = recordingFetch(
      bodyResponse(8, { 'Content-Length': String(6 * 1024 * 1024 * 1024) })
    );

    const err = await relayErrorFrom(
      fetchSourceInBrowser('https://cdn.example.com/huge.mp4', undefined, fetchFn)
    );

    expect(err.code).toBe('RELAY_TOO_LARGE');
  });

  it('refuses a bodyless response', async () => {
    const { fetchFn } = recordingFetch(new Response(null, { status: 204 }));

    const err = await relayErrorFrom(fetchSourceInBrowser(signUrl, undefined, fetchFn));

    expect(err.code).toBe('RELAY_SOURCE_EMPTY');
  });

  // A rejected response still has an unread body, and the socket stays open until it is read or
  // canceled. On a refusal partway through a list of sources that adds up: connections the page never
  // reads from, held for as long as it lives.
  it.each([
    ['a denied link', new Response('denied', { status: 403 })],
    ['a server error', new Response('boom', { status: 500 })],
    ['an over-size source', bodyResponse(8, { 'Content-Length': String(6 * 1024 * 1024 * 1024) })],
  ])('releases the response body when rejecting %s', async (_label, response) => {
    const { fetchFn } = recordingFetch(response);

    await relayErrorFrom(fetchSourceInBrowser(signUrl, undefined, fetchFn));

    expect(response.bodyUsed).toBe(true);
  });
});
