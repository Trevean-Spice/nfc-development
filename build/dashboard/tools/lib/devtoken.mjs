/**
 * A development bearer token, minted with node:crypto so this package still depends on
 * nothing.
 *
 * There is no identity provider on a laptop. The API accepts a symmetric HS256 token in
 * local and staging stages and refuses that path outright when the stage is production, in
 * its own auth module rather than by configuration convention. This mints exactly the token
 * the API's own test harness mints, and it has no meaning anywhere else.
 */

import { createHmac } from 'node:crypto';

export const DEV_SECRET_ENV = 'SECRET_TREVEAN_API_DEV_JWT_SECRET';
export const DEV_SECRET_DEFAULT = 'local-development-signing-key-not-for-any-real-environment';
export const DEV_ISSUER = 'https://auth.local.treveanspice.com';
export const DEV_AUDIENCE = 'trevean-admin';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function mintDevToken({
  roles = ['Viewer'],
  subject = 'user_dashboard_local',
  email = 'marketing@example.com',
  secret = process.env[DEV_SECRET_ENV] ?? DEV_SECRET_DEFAULT,
  issuer = DEV_ISSUER,
  audience = DEV_AUDIENCE,
  expiresInSeconds = 60 * 60 * 8,
} = {}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      roles,
      email,
      sub: subject,
      iss: issuer,
      aud: audience,
      iat: issuedAt,
      exp: issuedAt + expiresInSeconds,
    }),
  );
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${header}.${payload}.${signature}`;
}
