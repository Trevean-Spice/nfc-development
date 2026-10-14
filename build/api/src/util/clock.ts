/**
 * The clock, in one place, so that "now" is an input to this service rather than an
 * ambient fact about the machine it happens to be running on.
 *
 * WHY THIS FILE EXISTS. The scan write derives its partition key, its deduplication
 * window and its TTL from server time (see Data model document, section 4.1), and the
 * dashboard reads those keys back. A test that posts a beacon dated 17 August and then
 * asks the dashboard for 17 August is therefore only correct while the real clock is
 * still near 17 August. That is exactly the pathology the scaffold audit called out in
 * the client's prototype: a suite that fails for reasons unrelated to the code, every
 * day, until people stop reading it. Pinning the clock in the test is the fix. Rewriting
 * the dates to today would only move the failure to tomorrow.
 *
 * WHAT BELONGS BEHIND THIS SEAM. Business timestamps: values that are stored, returned
 * to a caller, or used to derive a key. Those have to be reproducible.
 *
 * WHAT DOES NOT. Elapsed wall time: the in process rate limiter window and the secrets
 * cache expiry. Those measure how long the process has actually been running, they never
 * leave the process, and freezing them would misrepresent what they measure. They stay
 * on Date.now() deliberately.
 */

export type Clock = () => number;

const systemClock: Clock = () => Date.now();

let current: Clock = systemClock;

/** Epoch milliseconds, from whichever clock is installed. */
export function now(): number {
  return current();
}

/**
 * Installs a clock. Test code only. There is no configuration path that reaches this, by
 * design: a production process must never be able to run on anything but real time.
 */
export function setClock(clock: Clock): void {
  current = clock;
}

/** Restores the system clock. Pair this with setClock in a test teardown. */
export function resetClock(): void {
  current = systemClock;
}

/** A clock frozen at an instant, given as an RFC 3339 timestamp. */
export function frozenAt(iso: string): Clock {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`frozenAt needs a parseable timestamp, got ${iso}`);
  return () => ms;
}
