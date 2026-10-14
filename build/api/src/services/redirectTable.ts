import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { knownSlugs } from '../http/spec.js';

/**
 * The redirect table: the load bearing artifact of the whole design.
 *
 * A thousand encoded, possibly write protected tags resolve through it. It lives in
 * version control, is reviewed like code, and is deployed with the application. Never as
 * hand-edited state in a hosting console, and never editable through this API by any role,
 * including Admin.
 *
 * A host migration that leaves this table behind does not break a deployment. Everything
 * comes up green. It strands 1,000 jars that are already in customers' kitchens, and
 * nobody finds out from a dashboard. Hence the checks below, and hence the fact that they
 * run at startup and not only in CI.
 *
 * This copy is the API's own deployment input. The application repository holds the
 * canonical file, and the CDN edge redirect configuration, this seed and the chip
 * programming tooling's input are all derived from that one source. See the Data model
 * document, section 7.
 */

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(here, '../../config/redirect-table.json');

export interface RedirectEntry {
  code: string;
  blendSlug: string;
  requestPath: string;
  targetPath: string;
  /**
   * The on-pack QR route. Same code, same table row, same destination page as the tap,
   * differing only in the via value the beacon reads after paint. See the document titled
   * "M1 Deliverable 14: QR attribution", section 2. Without it every QR scan is attributed
   * as a tap and the NFC versus QR split the Scope document requires cannot be produced.
   */
  qrRequestPath: string;
  qrTargetPath: string;
  /** The exact string Trevean encodes into the on-pack artwork. Unrecallable once printed. */
  qrUrl: string;
  unitsEncoded: number;
  status: 'encoded' | 'reserved';
  encodedOn: string | null;
  supplierOrderRef: string | null;
  chipPartNumber: string | null;
  writeProtected: boolean | null;
  ndefUri: string | null;
}

export interface RedirectTable {
  version: number;
  redirectStatus: number;
  origin: string;
  entries: RedirectEntry[];
}

/**
 * The six CI checks from the Data model document, section 7.4, as testable code, plus the
 * QR route checks from the document titled "M1 Deliverable 14: QR attribution", section 4.
 */
export function validateRedirectTable(table: RedirectTable, expectedEncodedUnits = 1000): string[] {
  const problems: string[] = [];
  const slugs = new Set(knownSlugs());
  const seen = new Set<string>();

  for (const entry of table.entries) {
    if (!/^[a-z]{2}$/.test(entry.code)) problems.push(`Code '${entry.code}' does not match ^[a-z]{2}$.`);
    if (seen.has(entry.code)) problems.push(`Code '${entry.code}' appears more than once.`);
    seen.add(entry.code);

    if (!slugs.has(entry.blendSlug)) problems.push(`Code '${entry.code}' points at unknown blend slug '${entry.blendSlug}'.`);

    if (entry.ndefUri !== null && !entry.ndefUri.endsWith(`/${entry.code}`)) {
      problems.push(`Code '${entry.code}' has an ndefUri that does not end with its own code.`);
    }
    if (entry.requestPath !== `/t/${entry.code}`) {
      problems.push(`Code '${entry.code}' has requestPath '${entry.requestPath}', expected '/t/${entry.code}'.`);
    }
    if (!entry.targetPath.includes(`blend=${entry.blendSlug}`) || !entry.targetPath.includes('via=nfc')) {
      problems.push(`Code '${entry.code}' has a targetPath missing blend=${entry.blendSlug} or via=nfc.`);
    }

    // The QR route. Checked as an equality against the tap target rather than as two
    // independent shape checks, because two shape checks both pass on a QR target pointing
    // at a different blend. This is the machine readable form of the QR parity requirement
    // in the Acceptance criteria document, section 6.1.
    if (entry.qrRequestPath !== `/q/${entry.code}`) {
      problems.push(`Code '${entry.code}' has qrRequestPath '${entry.qrRequestPath}', expected '/q/${entry.code}'.`);
    }
    if (!entry.qrTargetPath || !entry.qrTargetPath.includes('via=qr')) {
      problems.push(
        `Code '${entry.code}' has a qrTargetPath missing via=qr. Every QR scan would be attributed as a tap.`,
      );
    }
    if (entry.qrTargetPath !== entry.targetPath.replace('via=nfc', 'via=qr')) {
      problems.push(
        `Code '${entry.code}' has a qrTargetPath that is not the same destination as its targetPath. ` +
          'The QR route must differ from the tap route in the via value and in nothing else.',
      );
    }
    if (entry.qrUrl !== `${table.origin}/q/${entry.code}`) {
      problems.push(
        `Code '${entry.code}' has qrUrl '${entry.qrUrl}', expected '${table.origin}/q/${entry.code}'. ` +
          'Artwork encoding the wrong string cannot be fixed after it is printed.',
      );
    }
  }

  const encodedUnits = table.entries
    .filter((e) => e.status === 'encoded')
    .reduce((sum, e) => sum + e.unitsEncoded, 0);
  if (encodedUnits !== expectedEncodedUnits) {
    problems.push(`Encoded units sum to ${encodedUnits}, expected ${expectedEncodedUnits}.`);
  }

  // 307 preserves the method and is explicitly temporary. A 301 gets cached permanently by
  // browsers and intermediaries, which would destroy the one property the whole design is
  // built on: destinations change by editing this table, tags are never re-encoded.
  if (table.redirectStatus !== 307) problems.push(`redirectStatus is ${table.redirectStatus}, expected 307.`);

  return problems;
}

let cached: RedirectTable | undefined;

export function loadRedirectTable(path = DEFAULT_PATH): RedirectTable {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as RedirectTable;
  const problems = validateRedirectTable(parsed);
  if (problems.length > 0) {
    throw new Error(`The redirect table failed validation:\n  ${problems.join('\n  ')}`);
  }
  return parsed;
}

export function redirectTable(): RedirectTable {
  if (!cached) cached = loadRedirectTable();
  return cached;
}

export function tagCodeForSlug(slug: string): string | null {
  return redirectTable().entries.find((e) => e.blendSlug === slug)?.code ?? null;
}
