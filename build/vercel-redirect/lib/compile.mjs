/**
 * Compiling the canonical table into Vercel platform configuration.
 *
 * The output is `vercel.json`: `redirects` served by Vercel's routing layer
 * before any function is invoked, and `headers` carrying the cache directive.
 * Nothing here is hand written and nothing downstream of here may be hand
 * edited. If the table and this output can ever disagree, the build is wrong.
 *
 * Every guarantee asserted below is one the CloudFront Function made, taken from
 * "M1 Deliverable 3: Redirect-Serving Decision and Apex Domain Routing",
 * section 5. They are checked here as well as in the test suite, because this is
 * the last point before an artifact becomes deployable, and because a
 * vercel.json is copied into a hosting project by hand at least once.
 */

import { ROUTES, KNOWN_BLEND_SLUGS } from './table.mjs';
import { sourcesFor, sourcesPerRow, isLiteralSource } from './variants.mjs';

/** The only status this configuration is allowed to emit. */
export const REDIRECT_STATUS = 307;

/**
 * The cache directive on the redirect itself. A cached redirect is an
 * uneditable redirect, and destinations changing by table edit rather than by
 * re-encoding a tag is the single property the whole design rests on.
 *
 * Vercel puts `public, max-age=0, must-revalidate` on a declarative redirect by
 * default. That is safe, since the browser has to revalidate every time, but it
 * is not what the specification says, so the specified value is set explicitly
 * and the verification script reports which one the deployment actually served.
 */
export const REDIRECT_CACHE_CONTROL = 'no-store';

export function compile(table) {
  assertTable(table);

  const redirects = [];
  for (const route of ROUTES) {
    for (const entry of table.entries) {
      const destination = entry[route.targetField];
      for (const source of sourcesFor(route.prefix, entry.code)) {
        redirects.push({ source, destination, statusCode: table.redirectStatus });
      }
    }
  }

  const headers = [];
  for (const route of ROUTES) {
    for (const prefix of [route.prefix.toLowerCase(), route.prefix.toUpperCase()]) {
      headers.push({
        source: `/${prefix}/(.*)`,
        headers: [{ key: 'Cache-Control', value: REDIRECT_CACHE_CONTROL }]
      });
    }
  }

  const config = { redirects, headers };
  assertConfig(config, table);
  return config;
}

/** The complete drop-in file, and the fragment for a project that already has a vercel.json. */
export function serialise(config) {
  return {
    vercelJson: `${JSON.stringify(config, null, 2)}\n`,
    redirectsFragment: `${JSON.stringify(config.redirects, null, 2)}\n`
  };
}

// ---------------------------------------------------------------------------
// The guarantees, checked before anything can be deployed
// ---------------------------------------------------------------------------

function assertTable(table) {
  if (!table || !Array.isArray(table.entries) || table.entries.length === 0) {
    throw new Error('The redirect table has no entries. Refusing to emit a configuration that serves nothing.');
  }
  if (table.redirectStatus !== REDIRECT_STATUS) {
    throw new Error(
      `The table declares redirectStatus ${table.redirectStatus}. Only ${REDIRECT_STATUS} is permitted. ` +
        'A 301 or a 308 is cached by browsers and by intermediaries, which would make the destination ' +
        'un-editable on every device that had ever tapped a jar.'
    );
  }

  const seenCodes = new Set();
  for (const entry of table.entries) {
    if (!/^[a-z]{2}$/.test(entry.code)) {
      throw new Error(`Code ${JSON.stringify(entry.code)} is not two lowercase letters.`);
    }
    if (seenCodes.has(entry.code)) {
      throw new Error(`Code ${entry.code} appears twice in the table.`);
    }
    seenCodes.add(entry.code);

    if (!KNOWN_BLEND_SLUGS.includes(entry.blendSlug)) {
      throw new Error(
        `Code ${entry.code} points at blend slug ${JSON.stringify(entry.blendSlug)}, which is not one of the ` +
          `five blends in Scope, section "Tag code map": ${KNOWN_BLEND_SLUGS.join(', ')}.`
      );
    }

    // The two routes must reach the same blend and differ only in the via value.
    // This is the check that catches half a transposition: a row whose tap and
    // QR targets disagree with each other.
    const tap = entry.targetPath;
    const qr = entry.qrTargetPath;
    assertDestination(entry.code, 'tap', tap, entry.blendSlug, 'nfc');
    assertDestination(entry.code, 'QR', qr, entry.blendSlug, 'qr');
    if (qr !== tap.replace('via=nfc', 'via=qr')) {
      throw new Error(
        `Code ${entry.code} resolves to two different destinations: ${tap} on the tap and ${qr} on the QR. ` +
          'The QR must differ from the tap in the via value only.'
      );
    }
  }
}

function assertDestination(code, label, destination, blendSlug, via) {
  if (typeof destination !== 'string' || destination.length === 0) {
    throw new Error(`Code ${code} has no ${label} destination.`);
  }
  if (!destination.startsWith('/') || destination.startsWith('//')) {
    throw new Error(
      `The ${label} destination for ${code} is ${JSON.stringify(destination)}. It must be a relative ` +
        'same origin path so the browser keeps the connection it already has.'
    );
  }
  if (destination.includes('://')) {
    throw new Error(
      `The ${label} destination for ${code} is absolute. A cross origin target costs a second DNS lookup ` +
        'plus a second TCP and TLS handshake, 450 ms at the design point in "Per-page byte and speed budget", section 3.'
    );
  }
  const queryIndex = destination.indexOf('?');
  if (queryIndex === -1) {
    throw new Error(`The ${label} destination for ${code} carries no query string, so the page cannot know which blend it is.`);
  }
  const keys = destination
    .slice(queryIndex + 1)
    .split('&')
    .map((pair) => pair.split('=')[0]);
  if (keys.length !== 2 || keys[0] !== 'blend' || keys[1] !== 'via') {
    throw new Error(
      `The ${label} destination for ${code} carries the parameters ${JSON.stringify(keys)}. ` +
        'It must carry blend and via, in that order, and nothing else.'
    );
  }
  if (!destination.includes(`blend=${blendSlug}`)) {
    throw new Error(
      `The ${label} destination for ${code} does not carry blend=${blendSlug}. A customer holding that jar ` +
        'would be shown another blend, which is a SOW section 6.1 correct destination failure that no ' +
        'speed measurement can see.'
    );
  }
  if (!destination.includes(`via=${via}`)) {
    throw new Error(`The ${label} destination for ${code} does not carry via=${via}.`);
  }
}

function assertConfig(config, table) {
  const expected = table.entries.reduce((total, entry) => total + ROUTES.length * sourcesPerRow(entry.code), 0);
  if (config.redirects.length !== expected) {
    throw new Error(`Compiled ${config.redirects.length} redirects, expected ${expected}.`);
  }

  const destinations = new Set();
  for (const entry of table.entries) {
    destinations.add(entry.targetPath);
    destinations.add(entry.qrTargetPath);
  }

  const seen = new Set();
  for (const redirect of config.redirects) {
    if (!isLiteralSource(redirect.source)) {
      throw new Error(
        `Source ${JSON.stringify(redirect.source)} is not a literal path. A source containing ` +
          'path-to-regexp syntax can capture a parameter, and an unconsumed parameter can be appended ' +
          'to the destination. Nothing from the request may reach the destination.'
      );
    }
    if (seen.has(redirect.source)) {
      throw new Error(`Source ${redirect.source} is declared twice. The second one is unreachable.`);
    }
    seen.add(redirect.source);

    if (redirect.statusCode !== REDIRECT_STATUS) {
      throw new Error(`Source ${redirect.source} declares status ${redirect.statusCode}. Only ${REDIRECT_STATUS} is permitted.`);
    }
    if ('permanent' in redirect) {
      throw new Error(`Source ${redirect.source} declares permanent. Vercel rejects permanent alongside statusCode, and a permanent redirect is the failure this design forbids.`);
    }
    if (!destinations.has(redirect.destination)) {
      throw new Error(
        `Source ${redirect.source} points at ${JSON.stringify(redirect.destination)}, which is not a ` +
          'destination in the canonical table. Every destination is derived from the table or the build is wrong.'
      );
    }
  }

  for (const header of config.headers) {
    const values = header.headers.map((pair) => `${pair.key}: ${pair.value}`);
    if (!values.includes(`Cache-Control: ${REDIRECT_CACHE_CONTROL}`)) {
      throw new Error(`Header rule ${header.source} does not set Cache-Control: ${REDIRECT_CACHE_CONTROL}.`);
    }
  }

  const serialised = JSON.stringify(config);
  for (const forbidden of ['301', '302', '308']) {
    if (serialised.includes(`"statusCode": ${forbidden}`) || serialised.includes(`"statusCode":${forbidden}`)) {
      throw new Error(`The compiled configuration can return ${forbidden}. Only ${REDIRECT_STATUS} is permitted.`);
    }
  }
}
