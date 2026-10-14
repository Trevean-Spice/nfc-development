import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { config } from '../config/env.js';
import { secrets } from '../config/secrets.js';
import { tokenExpired, unauthenticated } from '../http/errors.js';
import { isRole, type Principal, type Role } from './roles.js';

/**
 * Bearer JWT validation for every /v1/admin/* endpoint, API contract section 5.3.
 * Validated on signature, issuer, audience and expiry. Nothing else is trusted.
 *
 * Two key sources:
 *   1. The managed identity provider's JWKS on the Trevean AWS account. This is the real
 *      one, and it is what runs in staging and production.
 *   2. A symmetric development key read from the secret provider. This exists because we
 *      do not have AWS access yet and the suite has to mint tokens to prove that every
 *      admin write rejects an unauthenticated request. It is refused outright when STAGE
 *      is production, in this file, not by configuration convention.
 */

let remoteJwks: JWTVerifyGetKey | undefined;

function jwks(): JWTVerifyGetKey {
  if (!config.auth.jwksUri) {
    throw new Error('AUTH_JWKS_URI is not configured and development tokens are not allowed.');
  }
  if (!remoteJwks) remoteJwks = createRemoteJWKSet(new URL(config.auth.jwksUri));
  return remoteJwks;
}

function rolesFrom(payload: JWTPayload): Role[] {
  const raw = (payload as Record<string, unknown>)['roles'] ?? (payload as Record<string, unknown>)['cognito:groups'];
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[ ,]+/) : [];
  return values.filter(isRole);
}

export function bearerFrom(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1];
}

export async function verifyAccessToken(token: string): Promise<Principal> {
  const options = { issuer: config.auth.issuer, audience: config.auth.audience };
  try {
    let payload: JWTPayload;
    if (config.auth.jwksUri) {
      ({ payload } = await jwtVerify(token, jwks(), options));
    } else if (config.auth.allowDevSymmetricTokens) {
      const secret = new TextEncoder().encode(await secrets().get(config.auth.devSharedSecretName));
      ({ payload } = await jwtVerify(token, secret, options));
    } else {
      throw new Error('No verification key is configured for this stage.');
    }

    const roles = rolesFrom(payload);
    if (roles.length === 0) {
      // A token with no recognised role is not an authorisation failure to describe in
      // detail. It is a token this API cannot act on at all.
      throw unauthenticated('The access token carries no recognised role claim.');
    }
    return {
      subject: typeof payload.sub === 'string' ? payload.sub : 'unknown',
      email: typeof payload['email'] === 'string' ? (payload['email'] as string) : undefined,
      roles,
    };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ERR_JWT_EXPIRED') throw tokenExpired();
    if ((err as Error).name === 'ApiError') throw err;
    throw unauthenticated('The access token is missing, malformed or not valid for this API.');
  }
}
