import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { isRole, type Principal, type Role } from './roles.js';

/**
 * Sessions.
 *
 * A signed cookie carrying the subject, the role and an expiry, and nothing else. The role
 * is inside the signature, so a session cookie edited in a browser fails verification
 * rather than granting a role. That is defence in depth and not the boundary: the API
 * validates its own bearer token independently, and the admin re-reads the role from the
 * user store on every request rather than trusting the cookie's copy of it.
 *
 * There is no CSRF exposure through a GET, because no GET in this application writes
 * anything. Every write is a POST carrying a per session token checked in guard.ts.
 */

export interface SessionPayload {
  subject: string;
  email: string;
  name: string;
  role: Role;
  csrf: string;
  expiresAt: number;
  /**
   * The identity provider's own token, carried so it can be presented to the API.
   *
   * Absent on a laptop, where the admin mints its own token with the symmetric development
   * key. Present in every deployed environment, where it is the Cognito id token and the API
   * verifies it against the pool's JWKS. The API already reads roles from the
   * `cognito:groups` claim, so nothing downstream needed changing.
   *
   * Without this a deployed admin signs somebody in successfully and then fails every screen
   * with a 401, because minting is refused outside development. That was observed rather than
   * predicted: see build/admin/DEPLOYMENT-NEXT-STEPS.md.
   */
  apiToken?: string;
}

function sign(value: string): string {
  return createHmac('sha256', config.session.secret).update(value).digest('base64url');
}

export function encodeSession(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

export function decodeSession(cookie: string | undefined): SessionPayload | undefined {
  if (!cookie) return undefined;
  const dot = cookie.lastIndexOf('.');
  if (dot < 1) return undefined;
  const body = cookie.slice(0, dot);
  const signature = cookie.slice(dot + 1);
  const expected = Buffer.from(sign(body), 'utf8');
  const supplied = Buffer.from(signature, 'utf8');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!isRole(payload.role)) return undefined;
    if (typeof payload.expiresAt !== 'number' || payload.expiresAt <= Date.now()) return undefined;
    return payload;
  } catch {
    return undefined;
  }
}

export function newSession(principal: Principal, apiToken?: string): SessionPayload {
  return {
    subject: principal.subject,
    email: principal.email,
    name: principal.name,
    role: principal.role,
    csrf: randomBytes(24).toString('base64url'),
    expiresAt: Date.now() + config.session.ttlSeconds * 1000,
    ...(apiToken ? { apiToken } : {}),
  };
}
