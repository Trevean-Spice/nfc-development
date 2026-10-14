import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { contract } from '../contract.js';
import { satisfies, type Principal, type Role } from './roles.js';
import { decodeSession, type SessionPayload } from './session.js';
import { users } from './users.js';

/**
 * Server side authorisation. This is the file that matters.
 *
 * An admin write endpoint reachable by an unauthenticated or under privileged caller is the
 * worst thing this application could ship with, so the rules here are deliberately dull:
 *
 * 1. Every route declares what it needs. There is no default. A route registered without a
 *    guard cannot reach anything, because the API client refuses to send a request whose
 *    contract minimum role the caller does not hold (see api/client.ts).
 * 2. The required role for anything that touches the API comes from `x-minimum-role` in the
 *    frozen contract, never from a table retyped here.
 * 3. The role is read from the user store on every request, not taken from the cookie. A
 *    role revoked one minute ago is revoked now, not at the end of an eight hour session.
 * 4. Insufficient role is 403 and never 404. Per the contract, section 5.3: hiding the
 *    existence of admin routes from an authenticated internal user buys nothing and makes
 *    support harder.
 * 5. Every write is a POST carrying the session's CSRF token. A form without it is refused.
 */

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
    session?: SessionPayload;
  }
}

export class Denied extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly reason: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'Denied';
  }
}

export function attachPrincipal(request: FastifyRequest): void {
  const raw = request.cookies?.[config.session.cookieName];
  const session = decodeSession(raw);
  if (!session) return;

  // Read the role back from the store, where there is a store to read.
  //
  // On a laptop the seeded provider is the authority and the cookie's copy is a
  // cache, so a role changed on the Roles screen takes effect on the next request
  // rather than at the next sign in.
  //
  // Against Cognito there is no local store to consult, and asking the identity
  // provider on every request would put a network call in front of every page.
  // The role travels in the signed session instead, which is exactly as
  // trustworthy: the cookie is HMAC signed with a secret this process holds, so a
  // tampered role fails decodeSession above. A role changed in Cognito takes
  // effect when the session is next minted, within the eight hour session life.
  //
  // Without this branch the deployed admin signs somebody in and then throws on
  // the next request, because users() refuses to construct the seeded store
  // outside development. Which is exactly what it did.
  if (config.devIdentity) {
    const user = users().find(session.subject);
    if (!user) return;

    request.session = session;
    request.principal = {
      subject: user.subject,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    return;
  }

  request.session = session;
  request.principal = {
    subject: session.subject,
    email: session.email,
    name: session.name,
    role: session.role,
  };
}

export function requireSignedIn(request: FastifyRequest): Principal {
  if (!request.principal) {
    throw new Denied(401, 'UNAUTHENTICATED', 'You are not signed in.');
  }
  return request.principal;
}

export function requireRole(request: FastifyRequest, required: Role): Principal {
  const principal = requireSignedIn(request);
  if (!satisfies(principal.role, required)) {
    throw new Denied(
      403,
      'INSUFFICIENT_ROLE',
      `This action requires the ${required} role. Your role is ${principal.role}.`,
    );
  }
  return principal;
}

/** The required role for a contract operation, resolved from the frozen document. */
export function requireOperation(request: FastifyRequest, operationId: string): Principal {
  return requireRole(request, contract().minimumRole(operationId));
}

/** True when this principal may perform the operation. Used to decide what the UI renders. */
export function may(principal: Principal | undefined, operationId: string): boolean {
  if (!principal) return false;
  return satisfies(principal.role, contract().minimumRole(operationId));
}

export function requireCsrf(request: FastifyRequest): void {
  const session = request.session;
  const body = (request.body ?? {}) as Record<string, unknown>;
  const supplied = typeof body['_csrf'] === 'string' ? body['_csrf'] : undefined;
  if (!session || !supplied || supplied !== session.csrf) {
    throw new Denied(403, 'CSRF_FAILED', 'This form was not submitted from your current session. Reload the page and try again.');
  }
}

/** Applied by the error handler. Kept here so the whole authorisation story is one file. */
export function deniedStatus(err: unknown): Denied | undefined {
  return err instanceof Denied ? err : undefined;
}

export function markDenied(reply: FastifyReply, denied: Denied): void {
  reply.status(denied.status);
  reply.header('x-admin-denied', denied.reason);
}
