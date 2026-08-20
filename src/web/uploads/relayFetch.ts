// Reading a remote source from the browser instead of the worker.
//
// Signed delivery links are frequently bound to the IP address that created them. A Cloudflare
// Worker egresses from Cloudflare's own addresses, so the edge refuses it no matter what headers the
// request carries — the only machine holding the right IP is the one the user is sitting at. This
// fetch runs in the tab, over the user's connection, and hands the body to the R2 staging driver.
//
// What the tab gains is the correct source IP, a real TLS fingerprint and a genuine User-Agent. What
// it gives up is CORS: `Referer` and `User-Agent` are forbidden header names, `Origin` is always
// sent, and a host that omits `Access-Control-Allow-Origin` makes the body unreadable. That last
// case is reported rather than worked around; `mode: 'no-cors'` would return an opaque response
// whose bytes cannot be read, which is no use at all.

import { MAX_UPLOAD_SIZE_BYTES } from '../../shared/contracts';

export type RelayErrorCode =
  | 'RELAY_CORS_BLOCKED'
  | 'RELAY_SOURCE_DENIED'
  | 'RELAY_SOURCE_HTTP_ERROR'
  | 'RELAY_SOURCE_EMPTY'
  | 'RELAY_TOO_LARGE'
  | 'RELAY_ABORTED';

export class RelayError extends Error {
  code: RelayErrorCode;
  status?: number;

  constructor(code: RelayErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'RelayError';
    this.code = code;
    this.status = status;
  }
}

export interface RelaySource {
  stream: ReadableStream<Uint8Array>;
  /** `0` when the response carried no `Content-Length`, which a streamed body often does not. */
  size: number;
  contentType: string | null;
}

/**
 * Open a streaming GET against a remote source.
 *
 * Deliberately not ranged. `Range` is not a CORS-safelisted request header, so per-part ranged
 * fetches would each trigger an `OPTIONS` preflight that most delivery endpoints ignore, and the
 * `Content-Range` / `Accept-Ranges` needed to interpret the answers are not safelisted *response*
 * headers either. `Content-Length` and `Content-Type` are both safelisted, so those read fine
 * without the host opting in via `Access-Control-Expose-Headers`.
 */
export async function fetchSourceInBrowser(
  url: string,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch
): Promise<RelaySource> {
  let res: Response;

  try {
    res = await fetchFn(url, {
      method: 'GET',
      // Nothing about this request should carry the user's identity on this app's behalf: the
      // token in the URL is the whole authorization.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'follow',
      cache: 'no-store',
      signal,
    });
  } catch (err) {
    const error = err as Error;
    if (signal?.aborted || error.name === 'AbortError') {
      throw new RelayError('RELAY_ABORTED', 'Transfer canceled');
    }

    // A CORS rejection and a genuine network failure are indistinguishable from script: the browser
    // reports both as an opaque TypeError with no response attached.
    throw new RelayError(
      'RELAY_CORS_BLOCKED',
      'Your browser could not read this source. The host most likely does not allow ' +
        'cross-origin reads (no Access-Control-Allow-Origin header), which nothing in this app ' +
        'can change. A dropped connection looks identical from here, so a retry is worth one try.'
    );
  }

  if (res.status === 401 || res.status === 403) {
    await discardBody(res);
    throw new RelayError(
      'RELAY_SOURCE_DENIED',
      `The source refused this link (HTTP ${res.status}). Signed links expire within hours and are ` +
        'often tied to the IP address that created them, so copy a fresh link from the same ' +
        'network you are browsing on.',
      res.status
    );
  }

  if (!res.ok) {
    await discardBody(res);
    throw new RelayError(
      'RELAY_SOURCE_HTTP_ERROR',
      `The source answered HTTP ${res.status} instead of sending the file.`,
      res.status
    );
  }

  if (!res.body) {
    throw new RelayError(
      'RELAY_SOURCE_EMPTY',
      'The source returned no body, so there is nothing to transfer.'
    );
  }

  const declared = Number(res.headers.get('Content-Length') || '0');
  const size = Number.isFinite(declared) && declared > 0 ? declared : 0;

  if (size > MAX_UPLOAD_SIZE_BYTES) {
    await discardBody(res);
    throw new RelayError(
      'RELAY_TOO_LARGE',
      `This file is ${(size / (1024 * 1024 * 1024)).toFixed(2)} GiB, over the 5 GiB maximum.`
    );
  }

  const rawType = res.headers.get('Content-Type');
  const contentType = rawType ? rawType.split(';')[0].trim() || null : null;

  return { stream: res.body, size, contentType };
}

/**
 * Release a response whose body will never be read.
 *
 * Every rejection here happens with the body still unconsumed, and the socket stays open until it is
 * either read or canceled. On a multi-gigabyte source that the host refuses mid-list, abandoning the
 * stream keeps the connection — and the browser's per-host connection slot — tied up for the life of
 * the page.
 */
async function discardBody(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => undefined);
}
