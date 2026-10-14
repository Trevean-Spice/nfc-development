import { randomBytes } from 'node:crypto';

/**
 * ULID generation, implemented here rather than taken from a library.
 *
 * The API contract requires every requestId and every generated identifier to match
 * ^[0-9A-HJKMNP-TV-Z]{26}$, which is Crockford base32 with I, L, O and U removed. That is
 * about thirty lines of code, and every dependency we take on has to be listed and
 * licensed to Trevean under the background IP obligation in the Scope document,
 * "IP and handoff". A dependency is not worth it for thirty lines.
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number): string {
  let out = '';
  let value = now;
  for (let i = TIME_LEN - 1; i >= 0; i -= 1) {
    const mod = value % 32;
    out = ENCODING[mod] + out;
    value = (value - mod) / 32;
  }
  return out;
}

function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_LEN);
  let out = '';
  for (let i = 0; i < RANDOM_LEN; i += 1) {
    out += ENCODING[(bytes[i] as number) % 32];
  }
  return out;
}

/** A 26 character ULID. Lexicographically sortable by generation time. */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}
