// Authentication utilities with PKCE flow
import type { TokenResponse } from './types';

const GOOGLE_OAUTH_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';

const SCOPES = [
  'https://www.googleapis.com/auth/drive', // Full Drive access for file management
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

// Replace with your OAuth Client ID from Google Cloud Console
export const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID_PLACEHOLDER.apps.googleusercontent.com';
export const CLIENT_SECRET = 'YOUR_GOOGLE_CLIENT_SECRET_PLACEHOLDER'; // Add your client secret here

// Redirect URI for Chrome Extension
export function getRedirectUri(): string {
  return `https://${chrome.runtime.id}.chromiumapp.org/`;
}

// PKCE helpers
async function sha256Base64Url(input: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  const bytes = new Uint8Array(digest);
  let s = '';
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomUrlSafe(n = 64): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let out = '';
  const rnd = crypto.getRandomValues(new Uint8Array(n));
  for (let i = 0; i < n; i++) out += alphabet[rnd[i] % alphabet.length];
  return out;
}

function parseUrlParams(url: string): Record<string, string> {
  const u = new URL(url);
  const all = new URLSearchParams(u.search || u.hash.replace(/^#/, ''));
  const obj: Record<string, string> = {};
  all.forEach((v, k) => (obj[k] = v));
  return obj;
}

// Main OAuth PKCE flow
export async function startOAuthPKCE(): Promise<TokenResponse> {
  const state = randomUrlSafe(32);
  const codeVerifier = randomUrlSafe(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);

  const authUrl = new URL(GOOGLE_OAUTH_AUTH);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', getRedirectUri());
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const redirectUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  if (!redirectUrl) throw new Error('No redirect URL returned from auth flow');

  const params = parseUrlParams(redirectUrl);
  if (params.error) throw new Error(`OAuth error: ${params.error}`);
  if (params.state !== state) throw new Error('State mismatch');
  const code = params.code;
  if (!code) throw new Error('Missing authorization code');

  // Exchange code for tokens
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    code_verifier: codeVerifier,
    redirect_uri: getRedirectUri(),
    grant_type: 'authorization_code',
  });

  const tokenResp = await fetch(GOOGLE_OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    throw new Error(`Token exchange failed: ${tokenResp.status} ${text}`);
  }

  const tokens = (await tokenResp.json()) as Omit<TokenResponse, 'obtained_at'>;
  return { ...tokens, obtained_at: Date.now() };
}

// Refresh access token using refresh token
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const tokenResp = await fetch(GOOGLE_OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    let errorObj: any;
    
    try {
      errorObj = JSON.parse(text);
    } catch {
      // If not JSON, throw generic error
      throw new Error(`Token refresh failed: ${tokenResp.status} ${text}`);
    }

    // Handle specific error types with detailed user-friendly messages
    if (errorObj.error === 'invalid_grant') {
      const description = errorObj.error_description || '';
      
      if (description.includes('expired') || description.includes('revoked')) {
        throw new Error(
          'Your Google account session has expired or access has been revoked. ' +
          'Please remove this account from the Account Manager and sign in again to restore access.'
        );
      }
      
      throw new Error(
        'Unable to refresh access token. The refresh token may be invalid. ' +
        'Please remove this account and sign in again.'
      );
    }

    if (errorObj.error === 'invalid_client') {
      throw new Error(
        'Authentication configuration error. Please contact the extension developer.'
      );
    }

    // Generic error with parsed details
    const errorMsg = errorObj.error_description || errorObj.error || text;
    throw new Error(`Token refresh failed: ${errorMsg}`);
  }

  const tokens = (await tokenResp.json()) as Omit<TokenResponse, 'obtained_at'>;
  return {
    ...tokens,
    refresh_token: refreshToken, // Keep the original refresh token
    obtained_at: Date.now(),
  };
}

// Check if token is expired or will expire soon (within 5 minutes)
export function isTokenExpired(tokens: TokenResponse): boolean {
  const expiresAt = tokens.obtained_at + tokens.expires_in * 1000;
  const now = Date.now();
  return now >= expiresAt - 5 * 60 * 1000; // 5 minutes buffer
}

// Get valid token (refresh if needed)
export async function getValidToken(tokens: TokenResponse | null): Promise<string> {
  if (!tokens) {
    throw new Error('Not authenticated');
  }

  if (isTokenExpired(tokens) && tokens.refresh_token) {
    const newTokens = await refreshAccessToken(tokens.refresh_token);
    await chrome.storage.local.set({ driveTokens: newTokens });
    return newTokens.access_token;
  }

  return tokens.access_token;
}
