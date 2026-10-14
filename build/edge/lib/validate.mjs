/**
 * Validation of the canonical redirect table.
 *
 * Implements the six CI checks in "M1 Deliverable 2: Data model", section 7.4,
 * plus three added here that protect properties the redirect-serving decision
 * treats as load bearing.
 *
 * The failure this exists to prevent is not a crash. It is a table edit that
 * deploys green and opens Caribbean Sunset on 250 Persian Sunrise jars.
 */

import { KNOWN_BLEND_SLUGS } from './table.mjs';

const CODE_PATTERN = /^[a-z]{2}$/;
const TOTAL_UNITS_ENCODED = 1000;

/**
 * @param {object} table
 * @param {object} [options]
 * @param {object|null} [options.previous] the previously deployed or committed table
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validate(table, options = {}) {
  const errors = [];
  const warnings = [];
  const previous = options.previous || null;

  const fail = (message) => errors.push(message);

  if (!Array.isArray(table.entries) || table.entries.length === 0) {
    fail('entries is missing or empty. The table serves nothing.');
    return { errors, warnings };
  }

  // Check 6, first because it is the one that cannot be undone in the field.
  if (table.redirectStatus !== 307) {
    fail(
      `redirectStatus is ${JSON.stringify(table.redirectStatus)}, must be 307. ` +
        'A 301 or 308 is cached by browsers and intermediaries, which makes the ' +
        'destination un-editable across the installed base with no server side fix.'
    );
  }

  // Check 1: code shape and uniqueness.
  const seenCodes = new Set();
  for (const entry of table.entries) {
    if (!CODE_PATTERN.test(entry.code || '')) {
      fail(`code ${JSON.stringify(entry.code)} does not match ^[a-z]{2}$.`);
    }
    if (seenCodes.has(entry.code)) {
      fail(`code ${JSON.stringify(entry.code)} appears more than once.`);
    }
    seenCodes.add(entry.code);
  }

  // Check 2: every blendSlug is one of the five real slugs.
  for (const entry of table.entries) {
    if (!KNOWN_BLEND_SLUGS.includes(entry.blendSlug)) {
      fail(
        `code ${JSON.stringify(entry.code)} points at blendSlug ` +
          `${JSON.stringify(entry.blendSlug)}, which is not one of the five blends.`
      );
    }
  }

  // Added: no two codes may resolve to the same blend. With five codes and five
  // blends the mapping is a bijection, so a duplicate means one blend became
  // unreachable, which is the quiet half of a transposed entry.
  const bySlug = new Map();
  for (const entry of table.entries) {
    const existing = bySlug.get(entry.blendSlug);
    if (existing) {
      fail(
        `codes ${JSON.stringify(existing)} and ${JSON.stringify(entry.code)} both ` +
          `resolve to ${JSON.stringify(entry.blendSlug)}. One blend is now unreachable.`
      );
    }
    bySlug.set(entry.blendSlug, entry.code);
  }

  // Check 3: the code appears consistently in every field that carries it, and
  // the target carries both parameters. Every row repeats the code three times
  // precisely so a one character typo cannot pass review.
  for (const entry of table.entries) {
    if (entry.requestPath !== `/t/${entry.code}`) {
      fail(
        `code ${JSON.stringify(entry.code)} has requestPath ` +
          `${JSON.stringify(entry.requestPath)}, expected "/t/${entry.code}".`
      );
    }
    if (entry.ndefUri !== null && !entry.ndefUri.endsWith(`/t/${entry.code}`)) {
      fail(
        `code ${JSON.stringify(entry.code)} has ndefUri ${JSON.stringify(entry.ndefUri)}, ` +
          `which does not end with "/t/${entry.code}". A tag encoded from this row ` +
          'would resolve to a different blend than the row claims.'
      );
    }
    const target = entry.targetPath || '';
    if (!target.includes(`blend=${entry.blendSlug}`)) {
      fail(
        `code ${JSON.stringify(entry.code)} has targetPath ${JSON.stringify(target)}, ` +
          `which does not carry blend=${entry.blendSlug}.`
      );
    }
    if (!target.includes('via=nfc')) {
      fail(`code ${JSON.stringify(entry.code)} has a targetPath without via=nfc.`);
    }
  }

  // Added, and the machine readable form of the QR parity requirement in
  // Acceptance criteria, section 6.1: the QR route resolves to the same
  // destination page as the tap through the same table row, and the two targets
  // differ in exactly one thing, the via value the beacon reads after paint.
  //
  // Stated as an equality rather than as two independent shape checks, because
  // two shape checks would both pass on a QR target pointing at another blend.
  // This is the check that makes "identical experience" a property CI can hold,
  // and it is also what stops the QR split being produced by a target nobody
  // compared against the tap target it claims to mirror.
  for (const entry of table.entries) {
    const target = entry.targetPath || '';
    const qrTarget = entry.qrTargetPath;

    if (typeof qrTarget !== 'string' || qrTarget.length === 0) {
      fail(
        `code ${JSON.stringify(entry.code)} has no qrTargetPath. Without one the on-pack ` +
          'QR cannot be served, and Scope, in scope, item 6 requires an NFC versus QR split.'
      );
      continue;
    }
    if (!qrTarget.startsWith('/') || qrTarget.startsWith('//')) {
      fail(
        `code ${JSON.stringify(entry.code)} has qrTargetPath ${JSON.stringify(qrTarget)}, ` +
          'which is not a relative same origin path.'
      );
    }
    if (!qrTarget.includes(`blend=${entry.blendSlug}`)) {
      fail(
        `code ${JSON.stringify(entry.code)} has qrTargetPath ${JSON.stringify(qrTarget)}, ` +
          `which does not carry blend=${entry.blendSlug}.`
      );
    }
    if (!qrTarget.includes('via=qr')) {
      fail(
        `code ${JSON.stringify(entry.code)} has a qrTargetPath without via=qr. Every QR scan ` +
          'would be attributed as a tap and the dashboard split would be a fiction.'
      );
    }
    if (qrTarget !== target.replace('via=nfc', 'via=qr')) {
      fail(
        `code ${JSON.stringify(entry.code)} has targetPath ${JSON.stringify(target)} and ` +
          `qrTargetPath ${JSON.stringify(qrTarget)}, which are not the same destination. ` +
          'The QR route must differ from the tap route in the via value and in nothing else.'
      );
    }

    if (entry.qrRequestPath !== `/q/${entry.code}`) {
      fail(
        `code ${JSON.stringify(entry.code)} has qrRequestPath ` +
          `${JSON.stringify(entry.qrRequestPath)}, expected "/q/${entry.code}".`
      );
    }

    // qrUrl is the string a print vendor sets in artwork that cannot be
    // recalled once it is on a carton. It is checked against the origin and the
    // code rather than trusted, for the same reason ndefUri is.
    const expectedQrUrl = `${table.origin}/q/${entry.code}`;
    if (entry.qrUrl !== expectedQrUrl) {
      fail(
        `code ${JSON.stringify(entry.code)} has qrUrl ${JSON.stringify(entry.qrUrl)}, ` +
          `expected ${JSON.stringify(expectedQrUrl)}. Artwork encoding the wrong string ` +
          'cannot be fixed after it is printed.'
      );
    }
  }

  // Added: blendName is a field that reaches a print vendor through the generated QR
  // artwork sheet, so it is constrained rather than passed through.
  //
  // A comma is allowed, because a comma in a marketing name is an ordinary decision, and
  // derive.mjs quotes the field per RFC 4180 so it can no longer shift the columns to its
  // right. A carriage return or a line feed is refused: RFC 4180 permits one inside a
  // quoted field, plenty of spreadsheet and vendor tooling mishandles it, and no blend name
  // has any business containing one. Refusing it here is cheaper than discovering it in a
  // print run.
  for (const entry of table.entries) {
    const name = entry.blendName;
    if (typeof name !== 'string' || name.trim() === '') {
      fail(
        `code ${JSON.stringify(entry.code)} has blendName ${JSON.stringify(name)}. The QR ` +
          'artwork sheet carries this to a print vendor, so it must be a non empty string.'
      );
      continue;
    }
    if (/[\r\n]/.test(name)) {
      fail(
        `code ${JSON.stringify(entry.code)} has a blendName containing a line break. ` +
          'It would survive into the generated artwork sheet as a quoted multi line field, ' +
          'which vendor tooling reads inconsistently.'
      );
    }
    if (name !== name.trim()) {
      fail(
        `code ${JSON.stringify(entry.code)} has blendName ${JSON.stringify(name)} with ` +
          'leading or trailing whitespace, which reaches artwork as typed.'
      );
    }
  }

  // Added: the target must stay same origin and relative. A cross origin target
  // costs a second DNS lookup plus a second TCP and TLS handshake, 450 ms at the
  // design point, and the budget fails. Recorded as a constraint rather than a
  // preference so a later hosting change cannot quietly reintroduce it.
  for (const entry of table.entries) {
    const target = entry.targetPath || '';
    if (!target.startsWith('/') || target.startsWith('//')) {
      fail(
        `code ${JSON.stringify(entry.code)} has targetPath ${JSON.stringify(target)}, ` +
          'which is not a relative same origin path. See "Per-page byte and speed ' +
          'budget", section 3, decision A.'
      );
    }
  }

  // Added: a preload hint, if present, must also be same origin and relative.
  for (const entry of table.entries) {
    const hero = entry.heroPreloadPath;
    if (hero !== null && hero !== undefined && (typeof hero !== 'string' || !hero.startsWith('/') || hero.startsWith('//'))) {
      fail(
        `code ${JSON.stringify(entry.code)} has heroPreloadPath ${JSON.stringify(hero)}, ` +
          'which must be null or a relative same origin path.'
      );
    }
  }

  // Check 4: units encoded across the shipped run.
  const totalEncoded = table.entries
    .filter((e) => e.status === 'encoded')
    .reduce((sum, e) => sum + (Number(e.unitsEncoded) || 0), 0);
  if (totalEncoded !== TOTAL_UNITS_ENCODED) {
    fail(
      `unitsEncoded across status "encoded" rows is ${totalEncoded}, expected ` +
        `${TOTAL_UNITS_ENCODED}. 1,000 tags were encoded and shipped on 24 July 2026.`
    );
  }

  // Reserved rows must not claim inventory they do not have.
  for (const entry of table.entries) {
    if (entry.status === 'reserved' && Number(entry.unitsEncoded) !== 0) {
      fail(
        `code ${JSON.stringify(entry.code)} is reserved but claims ` +
          `${entry.unitsEncoded} units. Reserved means no tag in this run carries it.`
      );
    }
    if (entry.status === 'encoded' && !entry.ndefUri) {
      fail(`code ${JSON.stringify(entry.code)} is encoded but has no ndefUri.`);
    }
  }

  // Check 5: a code in the deployed table is never removed and never repointed
  // without an explicit allowRepoint. Repointing is the legitimate mechanism by
  // which destinations change without re-encoding tags, which is exactly why it
  // must never happen by accident.
  if (previous && Array.isArray(previous.entries)) {
    const repointsAllowed = table.allowRepoint === true;
    const now = new Map(table.entries.map((e) => [e.code, e]));
    for (const before of previous.entries) {
      const after = now.get(before.code);
      if (!after) {
        const message =
          `code ${JSON.stringify(before.code)} was removed. Any tag carrying it now ` +
          'returns 404. Set allowRepoint to true in the pull request if this is intended.';
        if (repointsAllowed) warnings.push(message);
        else fail(message);
        continue;
      }
      // qrTargetPath is compared as well as targetPath. Print artwork is no more
      // recallable than an encoded tag, so a QR route that changes destination
      // silently strands cartons exactly the way a repointed tap route strands
      // jars. Guarded only when the previous table carried the field, so the one
      // time addition of the QR route is not itself reported as a repoint.
      const qrRepointed =
        typeof before.qrTargetPath === 'string' && after.qrTargetPath !== before.qrTargetPath;
      if (after.blendSlug !== before.blendSlug || after.targetPath !== before.targetPath || qrRepointed) {
        const route = after.targetPath === before.targetPath ? 'qrTargetPath' : 'targetPath';
        const message =
          `code ${JSON.stringify(before.code)} was repointed on ${route} from ` +
          `${JSON.stringify(before[route])} to ${JSON.stringify(after[route])}.`;
        if (repointsAllowed) {
          warnings.push(`${message} Allowed by allowRepoint.`);
        } else {
          fail(
            `${message} Set allowRepoint to true in the pull request if this is ` +
              'intended, and say in the description which physical jars are affected.'
          );
        }
      }
    }
    if (repointsAllowed && table.version === previous.version) {
      fail('allowRepoint is set but version was not incremented. Bump version so the deployed table id changes.');
    }
  }

  if (table.allowRepoint === true && !previous) {
    warnings.push('allowRepoint is set but no previous table was supplied, so nothing was compared.');
  }

  return { errors, warnings };
}
