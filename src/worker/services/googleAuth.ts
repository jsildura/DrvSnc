import { Env } from '../env';
import { generateSecureRandomString } from './crypto';

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function generatePkcePair(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = base64UrlEncode(randomBytes);

  const encoder = new TextEncoder();
  const digestBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier));
  const codeChallenge = base64UrlEncode(new Uint8Array(digestBuffer));

  return { codeVerifier, codeChallenge };
}

export async function createAuthorizationUrl(
  env: Env,
  options: { redirectUri: string; loginHint?: string }
): Promise<{ url: string; state: string; codeVerifier: string }> {
  const { codeVerifier, codeChallenge } = await generatePkcePair();
  const state = generateSecureRandomString(24);

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', options.redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('prompt', 'select_account consent');

  if (options.loginHint && options.loginHint.includes('@')) {
    authUrl.searchParams.set('login_hint', options.loginHint);
  }

  return {
    url: authUrl.toString(),
    state,
    codeVerifier,
  };
}

export interface GoogleTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  idToken?: string;
}

export async function exchangeCode(
  env: Env,
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<GoogleTokenResponse> {
  const params = new URLSearchParams();
  params.set('client_id', env.GOOGLE_CLIENT_ID);
  params.set('client_secret', env.GOOGLE_CLIENT_SECRET);
  params.set('code', code);
  params.set('code_verifier', codeVerifier);
  params.set('grant_type', 'authorization_code');
  params.set('redirect_uri', redirectUri);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`Google OAuth code exchange failed with status ${res.status}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token?: string;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    idToken: json.id_token,
  };
}

export async function refreshAccessToken(
  env: Env,
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const params = new URLSearchParams();
  params.set('client_id', env.GOOGLE_CLIENT_ID);
  params.set('client_secret', env.GOOGLE_CLIENT_SECRET);
  params.set('refresh_token', refreshToken);
  params.set('grant_type', 'refresh_token');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`Google OAuth token refresh failed with status ${res.status}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  return {
    accessToken: json.access_token,
    expiresIn: json.expires_in,
  };
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Google profile with status ${res.status}`);
  }

  const json = (await res.json()) as {
    sub: string;
    email: string;
    name: string;
    picture?: string;
  };

  return {
    sub: json.sub,
    email: json.email,
    name: json.name,
    picture: json.picture,
  };
}
