import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiClient } from '../api/client.js';
import { mintApiToken } from '../auth/tokens.js';
import { requireSignedIn } from '../auth/guard.js';
import type { Principal } from '../auth/roles.js';

/**
 * One API client per request, carrying exactly the signed in principal's role.
 *
 * The token comes from the identity provider when there is one, and is minted locally only
 * when there is not. Presenting the provider's own token is what makes a deployed admin work
 * at all: minting is refused outside development, so without this every screen returns 401
 * after a successful sign in.
 */
export function apiFor(request: FastifyRequest): ApiClient {
  const carried = request.session?.apiToken;
  const token = carried ? async () => carried : mintApiToken;
  return new ApiClient(request.principal, token);
}

export function principalOf(request: FastifyRequest): Principal {
  return requireSignedIn(request);
}

export function sendHtml(reply: FastifyReply, body: string, status = 200): FastifyReply {
  reply.status(status).header('content-type', 'text/html; charset=utf-8');
  // Nothing in this tool is cacheable. It is behind a role and it shows draft content.
  reply.header('cache-control', 'private, no-store');
  return reply.send(body);
}

export type FormBody = Record<string, string | string[] | undefined>;

export function str(body: FormBody, key: string): string | undefined {
  const raw = body[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value : undefined;
}

/** An empty form field means "clear this", which the contract expresses as an explicit null. */
export function nullable(body: FormBody, key: string): string | null | undefined {
  const value = str(body, key);
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function text(body: FormBody, key: string): string | undefined {
  const value = str(body, key);
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function num(body: FormBody, key: string): number | null | undefined {
  const value = str(body, key);
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function intOf(body: FormBody, key: string): number | null | undefined {
  const value = num(body, key);
  return typeof value === 'number' ? Math.round(value) : value;
}

export function checked(body: FormBody, key: string): boolean {
  const value = str(body, key);
  return value === 'on' || value === 'true' || value === '1';
}

/** Lines of a textarea, trimmed, with blanks dropped. Used for recipe steps. */
export function lines(body: FormBody, key: string): string[] | undefined {
  const value = str(body, key);
  if (value === undefined) return undefined;
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * Indexed form fields, flattened.
 *
 * `story_text_0`, `story_text_1` and so on, rather than bracket notation, because the
 * default form body parser does not build nested objects from brackets and a parser that
 * silently produces a string where an object was expected is a bug that reaches the API as
 * a validation failure an editor cannot read.
 */
export function indexed(body: FormBody, prefix: string, max = 40): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  for (let i = 0; i < max; i += 1) {
    const entry: Record<string, string> = {};
    let any = false;
    for (const key of Object.keys(body)) {
      const match = new RegExp(`^${prefix}_([a-zA-Z]+)_${i}$`).exec(key);
      if (!match) continue;
      const value = str(body, key) ?? '';
      entry[match[1] as string] = value;
      if (value.trim() !== '') any = true;
    }
    if (any) out.push(entry);
  }
  return out;
}

/** Drop keys whose value is undefined so a PATCH never claims to change what it did not. */
export function compact(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
