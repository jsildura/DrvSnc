// Typed Web Client with CSRF & Error Normalization

export class ApiError extends Error {
  code: string;
  status: number;
  retriable: boolean;
  requestId?: string;

  constructor(code: string, message: string, status: number, retriable = false, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retriable = retriable;
    this.requestId = requestId;
  }
}

interface ApiErrorPayload {
  code?: string;
  message?: string;
  retriable?: boolean;
  requestId?: string;
}

let inMemoryCsrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  inMemoryCsrfToken = token;
}

export function getCsrfTokenFromCookie(): string | null {
  if (inMemoryCsrfToken) return inMemoryCsrfToken;
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)gdu_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  // Attach CSRF token on mutating requests
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrf = getCsrfTokenFromCookie();
    if (csrf && !headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', csrf);
    }
  }

  const response = await fetch(path, {
    ...options,
    method,
    headers,
    credentials: 'same-origin',
  });

  if (response.status === 204) {
    return {} as T;
  }

  let data: unknown;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    let message = response.statusText || 'API request failed';
    let code = `HTTP_${response.status}`;
    let retriable = false;
    let requestId = response.headers.get('x-request-id') || undefined;

    if (data && typeof data === 'object') {
      const obj = data as Record<string, any>;
      if (typeof obj.error === 'string') {
        message = obj.error;
      } else if (obj.error && typeof obj.error === 'object') {
        message = obj.error.message || message;
        code = obj.error.code || code;
        retriable = Boolean(obj.error.retriable);
        requestId = obj.error.requestId || requestId;
      } else if (typeof obj.message === 'string') {
        message = obj.message;
      }
    } else if (typeof data === 'string' && data.trim()) {
      message = data;
    }

    const error = new ApiError(code, message, response.status, retriable, requestId);

    // Only trigger app-level session logout when the application session itself is rejected,
    // NOT when an upstream Google Drive token or service operation returns 401 (e.g. DRIVE_UNAUTHORIZED)
    if (
      response.status === 401 &&
      (code === 'UNAUTHORIZED' || code === 'SESSION_EXPIRED') &&
      typeof window !== 'undefined'
    ) {
      window.dispatchEvent(new CustomEvent('gdu:unauthorized'));
    }

    throw error;
  }

  return data as T;
}
