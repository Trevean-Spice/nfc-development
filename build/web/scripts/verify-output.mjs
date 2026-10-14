#!/usr/bin/env node
/**
 * Verify the built output rather than assert things about it.
 *
 * Everything here is checked against the files that would actually be uploaded,
 * or against a live server serving them. Nothing is taken on trust from the
 * build log.
 *
 * Usage:
 *   node scripts/verify-output.mjs [--port 3200]
 *   TREVEAN_RELEASE=1 node scripts/verify-output.mjs     enables the release guard
 */

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'out');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const PORT = Number(arg('port', '3200'));

const failures = [];
const notes = [];
const passes = [];

function check(ok, label, detail) {
  if (ok) passes.push(label);
  else failures.push(detail ? `${label}: ${detail}` : label);
}

/* ------------------------------------------------------------- file walks -- */

function walk(dir, filter) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.lighthouseci') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...walk(full, filter));
    else if (filter(full)) found.push(full);
  }
  return found;
}

const blendPages = existsSync(join(out, 'blends'))
  ? readdirSync(join(out, 'blends')).filter((f) => f.endsWith('.html')).map((f) => join(out, 'blends', f))
  : [];

check(blendPages.length > 0, 'blend pages were exported', 'out/blends is empty, run npm run build');

/* ------------------------------------------------- 1. the document itself -- */

const DOCUMENT_BROTLI_CAP = 14336;
const INLINE_CSS_CAP = 9216;

for (const file of blendPages) {
  const name = relative(out, file).split('\\').join('/');
  const html = readFileSync(file, 'utf8');

  check(!/<script[^>]*\ssrc=/i.test(html), `${name}: no script with a src attribute`);
  check(!html.includes('/_next'), `${name}: no reference to the Next runtime`);
  check(!html.includes('__NEXT_DATA__'), `${name}: no inline hydration payload`);
  check(!/<link[^>]+rel=["']?stylesheet/i.test(html), `${name}: no render-blocking stylesheet`);

  const styles = html.match(/<style>([\s\S]*?)<\/style>/g) || [];
  check(styles.length === 1, `${name}: exactly one inline style block`, `found ${styles.length}`);
  const cssBytes = styles.length === 1 ? Buffer.byteLength(styles[0]) - 15 : 0;
  check(
    cssBytes <= INLINE_CSS_CAP,
    `${name}: inline CSS within the ${INLINE_CSS_CAP} byte cap`,
    `${cssBytes} bytes`,
  );

  const compressed = brotliCompressSync(Buffer.from(html), {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
  check(
    compressed <= DOCUMENT_BROTLI_CAP,
    `${name}: document within the ${DOCUMENT_BROTLI_CAP} byte Brotli cap`,
    `${compressed} bytes`,
  );

  // Exactly one image may carry fetchpriority high, and it must not be lazy.
  const priority = (html.match(/fetchpriority="high"/g) || []).length;
  check(priority === 1, `${name}: exactly one priority image`, `found ${priority}`);
  const heroTag = /<img[^>]*fetchpriority="high"[^>]*>/.exec(html);
  check(heroTag !== null && !/loading="lazy"/.test(heroTag[0]), `${name}: the hero is not lazy loaded`);
  check(heroTag !== null && /width="\d+"/.test(heroTag[0]) && /height="\d+"/.test(heroTag[0]),
    `${name}: the hero carries explicit width and height`);

  // Every other image must be lazy. Below the fold is 0 KB before readable.
  const images = html.match(/<img[^>]*>/g) || [];
  const nonLazy = images.filter((t) => !/loading="lazy"/.test(t) && !/fetchpriority="high"/.test(t));
  check(nonLazy.length === 0, `${name}: every below-fold image is lazy loaded`, `${nonLazy.length} eager`);

  // Platform-specific instruction copy. Copy that describes one platform's
  // behaviour as universal is a defect, not a wording preference. The agreed
  // wording is in the Hardware and physical layer document, "Customer
  // instruction copy", and is asserted here verbatim rather than by keyword, so
  // a rewrite that turns it into one sentence about "your phone" fails.
  check(/<h3>iPhone<\/h3>/.test(html), `${name}: carries iPhone-specific instructions`);
  check(/<h3>Android<\/h3>/.test(html), `${name}: carries Android-specific instructions`);
  check(
    html.includes(
      'Wake your phone, hold the top of the phone near the NFC symbol, and tap the notification ' +
        'when it appears.',
    ),
    `${name}: carries the agreed iPhone sentence verbatim`,
  );
  check(
    html.includes(
      'Unlock your phone and hold the NFC antenna area near the NFC symbol. The page should open ' +
        'automatically',
    ),
    `${name}: carries the agreed Android sentence verbatim`,
  );
  check(
    /a tap never opens a page on its own/.test(html),
    `${name}: says an iPhone tap never opens a page on its own`,
  );
  check(
    /Scan the QR code on the pack instead\. It opens this same page\./.test(html),
    `${name}: names the QR code as the recovery route`,
  );

  // The placeholder render contract, layer 3, rule 1, stated as an implication
  // rather than a conditional: a page built from a record carrying placeholder
  // content renders the banner. Checking only the reverse direction, that a
  // banner which is present is also styled, leaves the failure the convention
  // exists to prevent undetected, which is a page of invented copy with no
  // banner on it at all.
  const carriesPlaceholderCopy = html.includes('[PLACEHOLDER]') || html.includes('NOT REAL CONTENT');
  check(
    !carriesPlaceholderCopy || html.includes('class="placeholder-banner"'),
    `${name}: placeholder copy on the page means the placeholder banner is on the page`,
    'the page carries placeholder copy and renders no banner',
  );

  // The markers are in the markup above; without these rules in the inlined
  // stylesheet they are invisible on the page, which is the other half of the
  // same failure.
  if (html.includes('class="placeholder-banner"')) {
    for (const selector of ['.placeholder-banner', '.is-placeholder', '.placeholder-pending']) {
      check(
        new RegExp(`\\${selector}\\s*\\{`).test(html),
        `${name}: the inlined stylesheet styles ${selector}`,
      );
    }
    check(
      /position:\s*sticky/.test(html),
      `${name}: the placeholder banner is sticky, so a screenshot cannot miss it`,
    );
  }

  // The static map, and nothing that looks like a map SDK.
  check(!/mapbox|leaflet|maps\.google|googleapis\.com\/maps/i.test(html), `${name}: no map SDK`);
}

/* -------------------------------------------- 2. no third-party anything -- */

const FORBIDDEN = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'use.typekit.net',
  'p.typekit.net',
  'fast.fonts.net',
  'use.fontawesome.com',
  'cdn.jsdelivr.net',
  'googletagmanager.com',
  'google-analytics.com',
  'connect.facebook.net',
];

const shipped = walk(out, (f) => ['.html', '.js', '.json', '.css', '.webmanifest'].includes(extname(f)));
for (const host of FORBIDDEN) {
  const hit = shipped.find((f) => readFileSync(f, 'utf8').includes(host));
  check(!hit, `no reference to ${host} anywhere in the output`, hit ? relative(out, hit) : '');
}

/* ------------------------------------------------ 3. the privacy guarantee -- */

/** Comments are stripped first, so a comment explaining that the code never
    asks for a location is not mistaken for code that does. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

const scripts = walk(out, (f) => extname(f) === '.js');
for (const file of scripts) {
  const code = stripComments(readFileSync(file, 'utf8'));
  const name = relative(out, file).split('\\').join('/');
  check(
    !/navigator\s*\.\s*geolocation|\.\s*getCurrentPosition\s*\(|\.\s*watchPosition\s*\(/.test(code),
    `${name}: never asks for a location permission`,
  );
  check(!/document\s*\.\s*cookie/.test(code), `${name}: sets no cookie`);
  check(
    !/\b(chipUid|chipUID|tagUid|tagUID|perTagId|uniqueTapCode)\b/.test(code),
    `${name}: invents no per-tag identifier`,
  );
}
notes.push(
  'Geography comes from CDN viewer headers server side, to country, region and city only. ' +
    'The browser is never asked for a location permission.',
);

/* -------------------------------------------------- 4. the house style rule -- */

const styleTargets = [
  ...walk(join(root, 'src'), (f) => true),
  ...walk(join(root, 'scripts'), (f) => true),
  ...walk(join(root, 'public'), (f) => ['.js', '.webmanifest'].includes(extname(f))),
  ...shipped,
  ...(existsSync(join(root, 'README.md')) ? [join(root, 'README.md')] : []),
  ...(existsSync(join(root, 'MANIFEST.md')) ? [join(root, 'MANIFEST.md')] : []),
];
const dashed = [];
for (const file of styleTargets) {
  const text = readFileSync(file, 'utf8');
  if (/[\u2013\u2014]/.test(text)) dashed.push(relative(root, file).split('\\').join('/'));
}
check(dashed.length === 0, 'no en dashes and no em dashes anywhere', dashed.join(', '));

/* -------------------------------------------------- 5. the release guard -- */

const placeholderPages = blendPages.filter((f) => readFileSync(f, 'utf8').includes('PLACEHOLDER'));
if (process.env.TREVEAN_RELEASE === '1') {
  check(
    placeholderPages.length === 0,
    'release guard: no placeholder content in any blend page',
    `${placeholderPages.length} page(s) still carry placeholder copy`,
  );
} else if (placeholderPages.length > 0) {
  notes.push(
    `${placeholderPages.length} of ${blendPages.length} blend pages carry placeholder content and ` +
      'display the placeholder banner. Set TREVEAN_RELEASE=1 to turn that into a build failure.',
  );
}

/* ------------------------------------------- 6. live behaviour of the edge -- */

const server = spawn(process.execPath, [join(here, 'serve.mjs'), String(PORT)], {
  stdio: ['ignore', 'ignore', 'inherit'],
});

const base = `http://localhost:${PORT}`;
const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);

try {
  for (let i = 0; i < 60; i += 1) {
    try {
      const probe = await fetch(`${base}/blend.html?blend=persian-sunrise`);
      if (probe.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  // The 307, exactly. Not 301: a cached 301 makes the destination permanently
  // un-editable on every device that ever tapped a jar.
  const manifest = JSON.parse(readFileSync(join(out, 'route-manifest.json'), 'utf8'));
  for (const tag of manifest.tagCodes) {
    const response = await fetch(`${base}${tag.code}`, { redirect: 'manual' });
    check(response.status === 307, `${tag.code}: status is exactly 307`, `got ${response.status}`);
    check(
      response.headers.get('location') === tag.location,
      `${tag.code}: Location is ${tag.location}`,
      `got ${response.headers.get('location')}`,
    );
    check(
      (response.headers.get('location') || '').startsWith('/'),
      `${tag.code}: Location is a relative same-origin path`,
    );
    check(
      (response.headers.get('cache-control') || '').includes('no-store'),
      `${tag.code}: the redirect is not cacheable`,
    );
  }

  // QR parity, stated as bytes rather than as intent. The via parameter
  // distinguishes nfc from qr for analytics and changes nothing else.
  for (const slug of ['persian-sunrise', 'caribbean-sunset']) {
    const nfc = await (await fetch(`${base}/blend.html?blend=${slug}&via=nfc`)).text();
    const qr = await (await fetch(`${base}/blend.html?blend=${slug}&via=qr`)).text();
    const plain = await (await fetch(`${base}/blend.html?blend=${slug}`)).text();
    const utm = await (
      await fetch(`${base}/blend.html?blend=${slug}&via=qr&utm_source=pack&utm_campaign=launch`)
    ).text();
    check(
      sha(nfc) === sha(qr) && sha(nfc) === sha(plain) && sha(nfc) === sha(utm),
      `${slug}: via=nfc, via=qr, no via and utm_* all return identical bytes`,
      `${sha(nfc)} ${sha(qr)} ${sha(plain)} ${sha(utm)}`,
    );
    check(nfc.includes('data-blend="' + slug + '"'), `${slug}: the page names its own blend`);
  }

  // QR parity on the redirect path itself, which is the half that is easy to
  // leave half done. The on-pack QR is its own path, /q/{code}, resolving
  // through the same code and the same table as the tag. It must 307 to the
  // same destination page carrying via=qr, and the document that comes back
  // must be byte identical to the tapped one. Without this the dashboard cannot
  // produce the NFC and QR split at all, because nothing would ever emit
  // via=qr. See the document titled "M1 Deliverable 14: QR attribution".
  const qrByCode = new Map(manifest.qrCodes.map((q) => [q.code.replace('/q/', ''), q]));

  for (const tag of manifest.tagCodes.filter((t) => t.resolves)) {
    const code = tag.code.replace('/t/', '');
    const qr = qrByCode.get(code);
    check(Boolean(qr), `${tag.code}: the manifest carries a QR route for this code`);
    if (!qr) continue;

    const tapped = await fetch(`${base}${tag.code}`, { redirect: 'manual' });
    const scanned = await fetch(`${base}${qr.code}`, { redirect: 'manual' });

    check(
      scanned.status === 307 && scanned.headers.get('location') === qr.location,
      `${qr.code}: 307s to ${qr.location}`,
      `got ${scanned.status} ${scanned.headers.get('location')}`,
    );
    check(
      qr.location === tag.location.replace('via=nfc', 'via=qr'),
      `${qr.code}: the same destination page as ${tag.code}, differing only in via`,
      `${tag.location} against ${qr.location}`,
    );
    check(
      tapped.headers.get('location') === tag.location,
      `${tag.code}: the tap route is unchanged at via=nfc`,
      `got ${tapped.headers.get('location')}`,
    );

    // The route is the path and nothing else. A query parameter must not be
    // able to steer either redirect, because its value would end up in a
    // Location header and would be a candidate for the cache key.
    const steered = await fetch(`${base}${tag.code}?via=qr`, { redirect: 'manual' });
    check(
      steered.headers.get('location') === tag.location,
      `${tag.code}?via=qr: still answers via=nfc, the query string is never read`,
      `got ${steered.headers.get('location')}`,
    );
    const injected = await fetch(`${base}${qr.code}?via=%3Cscript%3E`, { redirect: 'manual' });
    check(
      injected.headers.get('location') === qr.location,
      `${qr.code}: nothing from the request is reflected into Location`,
      `got ${injected.headers.get('location')}`,
    );

    const viaTap = await (await fetch(`${base}${tag.code}`)).text();
    const viaQr = await (await fetch(`${base}${qr.code}`)).text();
    check(
      sha(viaTap) === sha(viaQr),
      `${tag.code}: the tapped page and the scanned page are the same bytes`,
      `${sha(viaTap)} ${sha(viaQr)}`,
    );
  }

  check(
    manifest.qrCode?.urlShape === 'https://treveanspice.com/q/{code}',
    'the route manifest states the URL the on-pack QR must encode',
  );

  // The check that would have caught the divergence this replaced. This package
  // held its own edge behaviour in scripts/serve.mjs and drifted from the
  // canonical table without anything failing. The canonical table is
  // build/edge/redirect-table.json and this manifest is informational, so the
  // only honest guard is to read the canonical file and compare. Skipped with a
  // note rather than failed if the edge package is not checked out beside this
  // one, because they are separate deliverables.
  const canonicalPath = join(root, '..', 'edge', 'redirect-table.json');
  if (!existsSync(canonicalPath)) {
    notes.push(
      'build/edge/redirect-table.json was not found, so the route manifest was not compared ' +
        'against the canonical redirect table. This package must never be the source of truth ' +
        'for a redirect.',
    );
  } else {
    const canonical = JSON.parse(readFileSync(canonicalPath, 'utf8'));
    for (const entry of canonical.entries) {
      const tag = manifest.tagCodes.find((t) => t.code === entry.requestPath);
      const qr = manifest.qrCodes.find((q) => q.code === entry.qrRequestPath);
      check(
        tag?.location === entry.targetPath,
        `${entry.requestPath}: the manifest agrees with the canonical redirect table`,
        `manifest ${tag?.location} against table ${entry.targetPath}`,
      );
      check(
        qr?.encodeInQr === entry.qrUrl && qr?.location === entry.qrTargetPath,
        `${entry.qrRequestPath}: the manifest agrees with the canonical redirect table`,
        `manifest ${qr?.encodeInQr} to ${qr?.location} against table ${entry.qrUrl} to ${entry.qrTargetPath}`,
      );
    }
  }

  // The correct destination, checked by content and not only by status. A
  // generic landing page, a 404 or the wrong blend fails regardless of speed.
  //
  // A code whose blend has no pre-rendered page must land on the branded
  // unresolved page and must not be quietly counted as working. That is correct
  // for /t/kg, which is reserved and was not in the production tag run, and it
  // would be a broken tap for any of the four codes that are on physical jars,
  // so the two cases are asserted separately rather than merged.
  for (const tag of manifest.tagCodes) {
    const response = await fetch(`${base}${tag.code}`);
    const page = await response.text();
    if (tag.resolves) {
      check(page.includes(`data-blend="${tag.slug}"`), `${tag.code}: renders the ${tag.slug} page`);
    } else {
      check(
        tag.units === 0,
        `${tag.code}: has no page, and no tag was encoded with it`,
        `${tag.units} units were encoded with a code that resolves to no page`,
      );
      check(
        response.status === 404 && page.includes('could not tell which jar'),
        `${tag.code}: reserved, so it lands on the branded unresolved page`,
        `got ${response.status}`,
      );
    }
  }

  // Unknown code, and unknown blend. Branded, never blank, never generic.
  const unknown = await fetch(`${base}/t/zz`);
  const unknownBody = await unknown.text();
  check(unknown.status === 404, 'an unknown tag code returns 404', `got ${unknown.status}`);
  check(unknownBody.includes('Trevean Spice'), 'the unknown code page is branded');

  const badBlend = await fetch(`${base}/blend.html?blend=not-a-blend`);
  const badBody = await badBlend.text();
  check(badBlend.status === 404, 'an unknown blend returns 404', `got ${badBlend.status}`);
  check(badBody.includes('could not tell which jar'), 'the unknown blend page is branded');

  const offline = await fetch(`${base}/offline.html`);
  check(offline.ok && (await offline.text()).includes('offline'), 'the branded offline page is present');

  // Case and trailing slash normalisation. Tags encode lowercase, but the QR
  // path and hand-typed URLs exist.
  const upper = await fetch(`${base}/T/PS/`, { redirect: 'manual' });
  check(upper.status === 307, 'an uppercase code with a trailing slash still resolves', `got ${upper.status}`);

  /*
   * The beacon endpoint, and the check that would have caught this before it
   * shipped.
   *
   * This assertion used to post the measurement harness's own record and assert
   * 202, because the stand-in accepted anything it could parse. The real API
   * sets additionalProperties false on ScanEventInput and answers 400 to that
   * body, so the page passed here and would have produced a scan count of zero
   * in production, silently. The stand-in now validates, and both halves are
   * asserted: the contract body is accepted, the harness record is refused.
   */
  const validScanEvent = {
    blendSlug: 'persian-sunrise',
    tagCode: 'ps',
    channel: 'qr',
    dedupToken: '9f2c41a7b6e04d8fa3c5d17e8b0f6a24',
    occurredAt: '2026-08-17T09:41:07Z',
    platform: 'ios',
    deviceFamily: 'iPhone',
    connectionType: '4g',
    cacheStatus: 'hit',
    ttfbMs: 184,
    timeToReadableMs: 1120,
    pageVersion: null,
    redirected: true,
  };
  const beacon = await fetch(`${base}/v1/scan-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validScanEvent),
  });
  check(beacon.status === 202, 'the scan beacon endpoint returns 202 for a ScanEventInput body', `got ${beacon.status}`);

  // A duplicate is 202 as well. The client cannot distinguish the two and must
  // not try. Frozen API contract, section 4.2.
  const duplicate = await fetch(`${base}/v1/scan-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validScanEvent),
  });
  check(duplicate.status === 202, 'a duplicate scan event returns 202 as well', `got ${duplicate.status}`);

  const harnessShaped = await fetch(`${base}/v1/scan-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema: 'trevean-field-beacon/1', blend: 'persian-sunrise', arrival: 'qr' }),
  });
  check(
    harnessShaped.status === 400,
    'the stand-in refuses the harness record shape, exactly as the real API does',
    `got ${harnessShaped.status}`,
  );

  // Section 8.3 names the user agent among the things the beacon must not send,
  // and additionalProperties false is what enforces it. Asserted separately,
  // because it is the field the privacy position turns on.
  const withUserAgent = await fetch(`${base}/v1/scan-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...validScanEvent, userAgent: 'Mozilla/5.0' }),
  });
  check(
    withUserAgent.status === 400,
    'a body carrying userAgent is refused',
    `got ${withUserAgent.status}`,
  );

  // A hyphenated UUID is the same 128 bits the contract asks for in a notation
  // it does not accept. This is what the beacon used to put in dedupeToken.
  const uuidToken = await fetch(`${base}/v1/scan-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...validScanEvent, dedupToken: '5d6a245d-c18d-492c-83a2-f0cf5203fd29' }),
  });
  check(
    uuidToken.status === 400,
    'a hyphenated UUID dedupToken is refused',
    `got ${uuidToken.status}`,
  );
} finally {
  server.kill();
}

/* ------------------------------------------------------------------ report -- */

console.log('');
console.log(`${passes.length} checks passed.`);
if (notes.length > 0) {
  console.log('');
  console.log('Notes:');
  for (const note of notes) console.log(`  ${note}`);
}
if (failures.length > 0) {
  console.log('');
  console.error(`${failures.length} check(s) FAILED:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('');
console.log('All checks passed.');
