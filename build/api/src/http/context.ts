import type { FastifyReply, FastifyRequest } from 'fastify';
import { bearerFrom, verifyAccessToken } from '../auth/jwt.js';
import { highestRole, satisfies, type Principal, type Role } from '../auth/roles.js';
import { insufficientRole, unauthenticated } from './errors.js';
import { CACHE_ADMIN } from './cache.js';

/**
 * Request context and the three authorisation zones from the API contract, section 5.
 *
 *   Public content reads   unauthenticated, because every byte they return is already
 *                          public in the rendered page
 *   The scan beacon        unauthenticated by necessity, constrained by shape: a browser
 *                          beacon cannot hold a secret, so the protection is that the body
 *                          accepts no free text and no identifiers of value
 *   Admin                  bearer JWT, role checked, on every single write
 */

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    principal?: Principal;
  }
}

/** Attaches the caller if a valid token is present. Never rejects: for public reads. */
export async function attachOptionalPrincipal(request: FastifyRequest): Promise<void> {
  const token = bearerFrom(request.headers.authorization);
  if (!token) return;
  try {
    request.principal = await verifyAccessToken(token);
  } catch {
    // A bad token on a public read is simply an anonymous read. Draft content stays
    // invisible, which is the same answer the caller would get with no token at all.
  }
}

/**
 * preHandler factory for every /v1/admin/* operation.
 *
 * An unauthenticated request is 401 and never reaches a handler. Insufficient role is 403
 * with INSUFFICIENT_ROLE, not 404: hiding the existence of admin routes from an
 * authenticated internal user buys nothing and makes support harder.
 */
export function requireRole(required: Role) {
  return async function guard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    reply.header('cache-control', CACHE_ADMIN);
    const token = bearerFrom(request.headers.authorization);
    if (!token) throw unauthenticated('Authentication is required for this endpoint.');
    const principal = await verifyAccessToken(token);
    request.principal = principal;
    if (!satisfies(principal.roles, required)) {
      throw insufficientRole(required, highestRole(principal.roles));
    }
  };
}

export function actorOf(request: FastifyRequest): string | undefined {
  return request.principal?.email ?? request.principal?.subject;
}
