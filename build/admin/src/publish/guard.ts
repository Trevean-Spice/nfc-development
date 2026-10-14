import { config } from '../config.js';
import type { PlaceholderReport } from '../content/placeholder.js';

/**
 * The placeholder publish guard.
 *
 * Publishing a blend whose page still carries invented looking content is allowed, because
 * refusing outright would mean the two seeded blends could never be put live for a demo and
 * somebody would work around the tool instead. It is allowed exactly once per publish, by a
 * person, deliberately, in writing, with their name on it.
 *
 * Four things are required together and none of them is optional:
 *
 *   1. The typed phrase. Not a checkbox on its own: a checkbox is one absent minded click.
 *   2. A reason of at least 20 characters, recorded in the audit log.
 *   3. An explicit acknowledgement of what is still placeholder, listed on the screen at
 *      the moment of the decision rather than linked from it.
 *   4. The override applies to this publish and nothing else. It is not stored, there is no
 *      environment variable that turns the guard off, and there is no "do not ask again".
 *      A convention with a manual off switch is a convention that gets switched off on the
 *      wrong day, which is the content package's own rule and it is right.
 */

export interface OverrideInput {
  phrase?: string;
  reason?: string;
  acknowledged?: boolean;
}

export type GuardDecision =
  | { allowed: true; overridden: false }
  | { allowed: true; overridden: true; reason: string; blockingFields: string[] }
  | { allowed: false; problems: string[]; blockingFields: string[] };

export function evaluate(report: PlaceholderReport, override: OverrideInput | undefined): GuardDecision {
  const blockingFields = report.findings
    .filter((f) => f.blocksPublish)
    .map((f) => `${f.record}: ${f.label}`);

  if (report.safeToPublish) return { allowed: true, overridden: false };

  const problems: string[] = [];
  const phrase = (override?.phrase ?? '').trim();
  const reason = (override?.reason ?? '').trim();

  if (phrase !== config.publish.overridePhrase) {
    problems.push(`Type the phrase ${config.publish.overridePhrase} exactly to confirm.`);
  }
  if (reason.length < 20) {
    problems.push('Give a reason of at least 20 characters. It is recorded against your name.');
  }
  if (override?.acknowledged !== true) {
    problems.push('Tick the acknowledgement that the fields listed above are not real content.');
  }

  if (problems.length > 0) return { allowed: false, problems, blockingFields };
  return { allowed: true, overridden: true, reason, blockingFields };
}

/** The sentence shown above the override form. Written once so it cannot soften over time. */
export const OVERRIDE_WARNING =
  "The fields listed below are not real. Publishing regenerates the page that 1,000 shipped jars resolve to, so anything on it that is invented reaches a customer and states something about Trevean's supply chain that nobody at Trevean said.";
