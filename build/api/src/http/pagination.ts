import { badRequest } from './errors.js';

/**
 * Cursor pagination, API contract section 8.4. Offset pagination is not offered, because
 * it does not exist cheaply in DynamoDB and pretending otherwise produces a table scan.
 *
 * The cursor is an opaque base64url encoding of the DynamoDB LastEvaluatedKey. Opaque
 * means clients must not parse it, and encoding it this way means we never have to invent
 * a second ordering to reproduce a page.
 */

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export function encodeCursor(key: Record<string, unknown> | undefined): string | null {
  if (!key) return null;
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined, strict: boolean): Record<string, unknown> | undefined {
  if (cursor === undefined || cursor === '') return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    if (strict) throw badRequest('1 field failed validation.', [{ field: 'cursor', issue: 'malformed' }]);
    return undefined;
  }
}

/**
 * `strict` is true only on operations whose OpenAPI entry declares a 400 response. On the
 * operations that do not declare one, an out of range limit is clamped rather than
 * rejected, because returning an undocumented status code is a contract violation and
 * clamping is not. This asymmetry is in the contract, not in this code: see the summary
 * note about operations that omit a 400 response.
 */
export function parseLimit(raw: unknown, strict: boolean): number {
  if (raw === undefined || raw === '') return DEFAULT_LIMIT;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    if (strict) throw badRequest('1 field failed validation.', [{ field: 'limit', issue: 'type_mismatch' }]);
    return DEFAULT_LIMIT;
  }
  if (n < 1 || n > MAX_LIMIT) {
    if (strict) throw badRequest('1 field failed validation.', [{ field: 'limit', issue: 'out_of_range' }]);
    return Math.min(Math.max(n, 1), MAX_LIMIT);
  }
  return n;
}
