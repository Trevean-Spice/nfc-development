/**
 * Compiling the canonical table into the CloudFront Function source.
 *
 * The table is never hand maintained in two places. src/handler.template.js
 * carries the behaviour and four substitution tokens; this module fills them in
 * and enforces the runtime's limits before the result can reach a deployment.
 */

import { readFileSync } from 'node:fs';
import {
  PATHS,
  MAX_FUNCTION_BYTES,
  WARN_FUNCTION_BYTES,
  targetsOf,
  qrTargetsOf,
  preloadsOf,
  tableId
} from './table.mjs';

const TOKEN_PATTERN = /__[A-Z_]+__/;

/**
 * Collapse the not found page to one line. Every text block in the source file
 * sits on its own line, so trimming and joining with nothing cannot split a
 * sentence or glue two words together.
 */
export function collapseHtml(html) {
  return html
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('');
}

/**
 * @param {object} table the canonical redirect table
 * @param {object} [sources] template and not found page, read from disk by default
 * @returns {{source: string, tableId: string, bytes: number, warnings: string[]}}
 */
export function compile(table, sources = {}) {
  const template = sources.template ?? readFileSync(PATHS.template, 'utf8');
  const notFoundHtml = collapseHtml(sources.notFoundHtml ?? readFileSync(PATHS.notFound, 'utf8'));

  const targets = targetsOf(table);
  const qrTargets = qrTargetsOf(table);
  const preloads = preloadsOf(table);
  const id = tableId(table, notFoundHtml);

  const substitutions = {
    __TARGETS__: JSON.stringify(targets),
    __QR_TARGETS__: JSON.stringify(qrTargets),
    __PRELOADS__: JSON.stringify(preloads),
    __TABLE_ID__: JSON.stringify(id),
    __NOT_FOUND_BODY__: JSON.stringify(notFoundHtml)
  };

  let source = template;
  for (const [token, value] of Object.entries(substitutions)) {
    if (!source.includes(token)) {
      throw new Error(`Template is missing the ${token} token. Refusing to emit a partial function.`);
    }
    source = source.split(token).join(value);
  }

  const leftover = source.match(TOKEN_PATTERN);
  if (leftover) {
    throw new Error(`Template still contains the unsubstituted token ${leftover[0]}.`);
  }

  const bytes = Buffer.byteLength(source, 'utf8');
  const warnings = [];

  if (bytes > MAX_FUNCTION_BYTES) {
    throw new Error(
      `Compiled function is ${bytes} bytes, over the CloudFront Functions limit of ` +
        `${MAX_FUNCTION_BYTES} bytes by ${bytes - MAX_FUNCTION_BYTES}. It cannot be ` +
        'deployed. Shrink the not found page, or move the mapping to a CloudFront ' +
        'KeyValueStore, which is still a viewer request lookup with no origin call ' +
        '(see "M1 Deliverable 3", section 5, "Forward note, not needed now").'
    );
  }
  if (bytes > WARN_FUNCTION_BYTES) {
    warnings.push(
      `Compiled function is ${bytes} bytes, over ${WARN_FUNCTION_BYTES} of the ` +
        `${MAX_FUNCTION_BYTES} byte limit. Headroom is getting thin.`
    );
  }

  // Properties asserted here as well as in the test suite, because this is the
  // last point before an artifact becomes deployable.
  if (source.includes('querystring') || source.includes('cookies')) {
    throw new Error(
      'Compiled function references the request query string or cookies. Reading ' +
        'either invites attribution parameters into the cache key, which fragments ' +
        'the cache and turns hits into origin fetches.'
    );
  }
  // Both routes must be distinguishable in the artifact. The state this
  // replaced was one in which every compiled target carried via=nfc, so no QR
  // scan could be told from a tap and the NFC versus QR split required by
  // Scope, in scope, item 6 could not be produced at all. Asserted on the
  // compiled maps rather than by searching the source, because a substring
  // search against a file generated from those same values proves nothing.
  for (const code of Object.keys(targets)) {
    const tap = targets[code];
    const qr = qrTargets[code];
    if (typeof tap !== 'string' || !tap.includes('via=nfc')) {
      throw new Error(`Compiled tap target for code ${code} does not carry via=nfc.`);
    }
    if (typeof qr !== 'string' || !qr.includes('via=qr')) {
      throw new Error(
        `Compiled QR target for code ${code} does not carry via=qr. Every QR scan would be ` +
          'attributed as a tap and the dashboard split would be a fiction.'
      );
    }
    if (qr !== tap.replace('via=nfc', 'via=qr')) {
      throw new Error(
        `Compiled routes for code ${code} do not resolve to the same destination: ` +
          `${tap} against ${qr}. The QR must differ from the tap in the via value only.`
      );
    }
  }

  const statuses = [...source.matchAll(/statusCode\s*:\s*(\d+)/g)].map((m) => m[1]);
  const allowed = new Set(['307', '404']);
  for (const status of statuses) {
    if (!allowed.has(status)) {
      throw new Error(`Compiled function can return status ${status}. Only 307 and 404 are permitted.`);
    }
  }

  return { source, tableId: id, bytes, warnings };
}

/** Convenience for tests and scripts that just want the deployable source. */
export function compileSource(table, sources) {
  return compile(table, sources).source;
}
