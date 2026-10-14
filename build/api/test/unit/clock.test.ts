import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { frozenAt, now, resetClock, setClock } from '../../src/util/clock.js';
import { deriveScanBuckets, nowIso } from '../../src/util/time.js';

/**
 * The clock seam, and the guard that keeps it a seam.
 *
 * This suite is going to be the client's continuous integration and the evidence base for
 * the 28 August gate. A suite that fails every day for reasons unrelated to the code is
 * worse than no suite, because people learn to ignore it, and the scaffold audit called
 * exactly that out in the prototype. Server time is therefore an input to this service,
 * and the test below is what stops it quietly becoming an ambient fact again.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

afterEach(() => {
  resetClock();
});

describe('the injectable clock', () => {
  it('is the system clock until a test replaces it, and is restorable', () => {
    const before = now();
    expect(Math.abs(before - Date.now())).toBeLessThan(1000);

    setClock(frozenAt('2026-08-17T09:41:07Z'));
    expect(now()).toBe(Date.parse('2026-08-17T09:41:07Z'));
    expect(now()).toBe(Date.parse('2026-08-17T09:41:07Z'));

    resetClock();
    expect(Math.abs(now() - Date.now())).toBeLessThan(1000);
  });

  it('refuses a timestamp it cannot parse rather than freezing at NaN', () => {
    expect(() => frozenAt('not a date')).toThrow();
  });

  it('reaches the functions that derive server time', () => {
    setClock(frozenAt('2026-08-17T09:41:07Z'));
    expect(nowIso()).toBe('2026-08-17T09:41:07Z');
    // The default receivedAt argument, which is what the beacon route relies on.
    expect(deriveScanBuckets('2026-08-17T09:41:07Z', 'a'.repeat(32)).day).toBe('2026-08-17');
  });

  it('makes the scan write reproducible on any date, which is the whole point', () => {
    // The exact case that broke: a fixture timestamp more than the 24 hour skew allowance
    // away from real time stops being trusted, gets bucketed against server time, and the
    // dashboard query for the fixture date then returns nothing. Pinned, it cannot happen.
    setClock(frozenAt('2026-08-17T09:41:07Z'));
    const pinned = deriveScanBuckets('2026-08-17T09:05:00Z', 'b'.repeat(32));
    expect(pinned.clientClockTrusted).toBe(true);
    expect(pinned.day).toBe('2026-08-17');
    expect(pinned.hour).toBe('2026-08-17T09');

    // A year later, same fixture, same answer.
    setClock(frozenAt('2027-08-17T09:41:07Z'));
    const later = deriveScanBuckets('2026-08-17T09:05:00Z', 'b'.repeat(32));
    expect(later.clientClockTrusted).toBe(false);
    expect(later.day).toBe('2027-08-17');
  });
});

/**
 * Every file allowed to read the real clock directly, with the reason. Anything else that
 * calls Date.now() or new Date() is reading the machine's clock behind the seam, which is
 * how the beacon route came to rot in the first place.
 */
const REAL_CLOCK_ALLOWED = new Map<string, string>([
  ['src/util/clock.ts', 'the seam itself'],
  ['src/util/ulid.ts', 'the ULID time prefix is identifier entropy, not a business timestamp'],
  ['src/http/rateLimit.ts', 'elapsed wall time inside one process, never leaves it'],
  ['src/config/secrets.ts', 'cache expiry, elapsed wall time, never leaves the process'],
  ['src/services/mediaUpload.ts', 'must match the presign expiry the AWS signer computed from real time'],
  ['src/observability/logger.ts', 'a log line should carry the time the machine actually emitted it'],
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('server time stays behind the seam', () => {
  it('has no unannotated reader of the real clock in src', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(resolve(root, 'src'))) {
      const key = relative(root, file).split('\\').join('/');
      if (REAL_CLOCK_ALLOWED.has(key)) continue;
      // Comments mentioning Date.now() are fine. Calls are not.
      const code = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
        .join('\n');
      if (/Date\.now\(\)|new Date\(\s*\)/.test(code)) offenders.push(key);
    }
    // If this fails, the fix is util/clock.ts, not an addition to the list above. Add to
    // the list only when the value genuinely has to track real wall time, and say why.
    expect(offenders).toEqual([]);
  });

  it('lists no file that has since stopped reading the real clock', () => {
    // Keeps the allow list honest, so it cannot quietly become a place stale entries hide.
    const stale: string[] = [];
    for (const key of REAL_CLOCK_ALLOWED.keys()) {
      const code = readFileSync(resolve(root, key), 'utf8');
      if (!/Date\.now\(\)|new Date\(\s*\)/.test(code)) stale.push(key);
    }
    expect(stale).toEqual([]);
  });
});
