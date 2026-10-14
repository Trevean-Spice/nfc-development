#!/usr/bin/env node
/**
 * Turn the Next.js export into the document the byte budget describes.
 *
 * Next renders the markup. It also ships 97 KB of hydration JavaScript that
 * this page has no use for, and a copy of every prop as inline JSON. Both are
 * removed here, deterministically, and the build fails if either survives.
 *
 * Why removal rather than configuration: Next has no supported "render this
 * route with no client runtime" switch. The choice is between shipping a
 * framework bundle that would spend most of the deferred JavaScript budget and
 * every one of the five pre-readable request slots, or rebuilding the document
 * from the rendered markup. The budget document is explicit that JavaScript
 * before readable is "not minimal, zero", so the document is rebuilt.
 *
 * What comes out:
 *
 *   - one HTML document per blend, whole stylesheet inlined, no <script src>,
 *     no _next reference, no __NEXT_DATA__
 *   - a 172 byte inline loader at the end of the body that fetches the
 *     enhancement module after the window load event and does nothing else
 *   - route-manifest.json, so the edge rewrite is generated from the build
 *   - build-report.json, with the measured Brotli size of every document
 *
 * Assertions, all of them fatal:
 *
 *   inline CSS      <= 9,216 bytes uncompressed   (budget section 4.1)
 *   HTML document   <= 14,336 bytes Brotli        (budget section 4.1)
 *   scripts with a src attribute                  0
 *   references to /_next                          0
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'out');

/* Numbers from the per-page byte and speed budget, section 4.1. The single
   source of truth for the gate is budget.json in the CI package; these are the
   same numbers asserted at build time so a breach is caught before CI. */
const DOCUMENT_BROTLI_CAP = 14336;
const INLINE_CSS_CAP = 9216;

/* Informational only. The authoritative redirect table is version controlled and
   deployed with the edge function, per decision D10. Source: Scope document,
   "Tag code map". */
const TAG_CODES = [
  { code: '/t/ps', slug: 'persian-sunrise', units: 250 },
  { code: '/t/cs', slug: 'caribbean-sunset', units: 250 },
  { code: '/t/sr', slug: 'silk-road', units: 250 },
  { code: '/t/nm', slug: 'north-african-night-market', units: 250 },
  { code: '/t/kg', slug: 'kyoto-garden', units: 0 },
];

const brotli = (text) =>
  brotliCompressSync(Buffer.from(text, 'utf8'), {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;

/* ----------------------------------------------------------------- styles -- */

/**
 * Comment stripping plus safe newline collapsing. A line break is removed only
 * where the previous meaningful character already terminates a token, and
 * becomes a single space otherwise, so no selector or shorthand value is ever
 * silently joined to its neighbour.
 */
function minifyCss(css) {
  let text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  text = text.replace(/\n\s*/g, (match, offset, whole) => {
    const before = whole.slice(0, offset).replace(/\s+$/, '');
    const last = before.charAt(before.length - 1);
    return last === ';' || last === '{' || last === '}' || last === ',' ? '' : ' ';
  });
  return text.trim();
}

/* The placeholder render contract, inlined with the rest.
 *
 * The content package's placeholder convention, "The three layers", layer 3,
 * requires the banner to be inside the inlined critical CSS rather than in an
 * async stylesheet, because a banner that paints late is a banner a screenshot
 * can miss. Without these rules the markers are in the markup and invisible on
 * the page, which is the failure the convention exists to prevent.
 *
 * src/styles/placeholder.css is a verbatim copy of the content package's
 * render-contract/placeholder.css, vendored so a checkout without the content
 * package still renders the markers. If both are present and they differ, the
 * build fails rather than shipping the older of the two.
 *
 * When the last placeholder goes away, delete the vendored file and the two
 * lines below. Nothing else has to be unpicked.
 */
const placeholderCssFile = join(root, 'src', 'styles', 'placeholder.css');
const placeholderCssSource = readFileSync(placeholderCssFile, 'utf8');
const contractFile = join(root, '..', 'content', 'render-contract', 'placeholder.css');
if (existsSync(contractFile) && readFileSync(contractFile, 'utf8') !== placeholderCssSource) {
  console.error(
    'FAIL src/styles/placeholder.css has drifted from the content package render contract at ' +
      'build/content/render-contract/placeholder.css. Copy the content package file over the ' +
      'vendored one and rebuild.',
  );
  process.exit(1);
}

const css = minifyCss(
  `${readFileSync(join(root, 'src', 'styles', 'critical.css'), 'utf8')}\n${placeholderCssSource}`,
);
if (Buffer.byteLength(css) > INLINE_CSS_CAP) {
  console.error(
    `FAIL inline CSS ${Buffer.byteLength(css)} bytes exceeds the ${INLINE_CSS_CAP} byte cap ` +
      '(per-page byte and speed budget, section 4.1).',
  );
  process.exit(1);
}

/* -------------------------------------------------------------- extraction -- */

const NEXT_OPEN = '<div id="__next">';
const NEXT_DATA = '<script id="__NEXT_DATA__"';

function extract(html) {
  const start = html.indexOf(NEXT_OPEN);
  const dataAt = html.indexOf(NEXT_DATA);
  if (start === -1 || dataAt === -1) {
    throw new Error('Next export shape changed: could not find #__next or __NEXT_DATA__.');
  }
  const closing = html.lastIndexOf('</div>', dataAt);
  // React emits the fetchPriority prop with its camelCase name. HTML attribute
  // names are case insensitive so browsers do the right thing either way, but
  // the CI greps and the audit trail read better lowercased.
  const markup = html.slice(start + NEXT_OPEN.length, closing).replace(/fetchPriority=/g, 'fetchpriority=');

  // Only head elements this project marked with data-keep survive. Everything
  // Next added for hydration is dropped by not being on the list.
  const head = [];
  const tagPattern = /<(title|meta|link)\b[^>]*data-keep="1"[^>]*>(?:([\s\S]*?)<\/title>)?/g;
  let match;
  while ((match = tagPattern.exec(html)) !== null) {
    const cleaned = match[0]
      .replace(/\s*data-keep="1"/, '')
      .replace(/\s*data-next-head=""/, '');
    head.push(cleaned);
  }
  if (head.length === 0) throw new Error('No head elements marked data-keep were found.');
  return { markup, head: head.join('') };
}

/* ---------------------------------------------------------------- document -- */

/* A data URI favicon, so the browser never issues a /favicon.ico request. One
   request saved is 150 ms at the design point, and the pre-readable request
   budget is five, all of them spoken for. */
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%231d1611'/%3E%3Cpath d='M9 21c3-9 11-9 14 0' stroke='%23b5651d' stroke-width='3' fill='none' stroke-linecap='round'/%3E%3C/svg%3E";

/* The only JavaScript in the document. It registers one load listener and
   appends one module element. No framework, no polyfill, no measurement. It
   issues no network request of its own, so the pre-readable request count and
   the pre-readable script byte count both stay at their budgeted values. */
const LOADER =
  '<script>addEventListener("load",function(){var s=document.createElement("script");' +
  's.type="module";s.src="/js/enhance.js";document.head.appendChild(s)},{once:true})</script>';

function document({ head, markup, rootAttrs, withLoader }) {
  const attrs = Object.entries(rootAttrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
  return (
    '<!DOCTYPE html><html lang="en"' +
    attrs +
    '><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<meta name="theme-color" content="#fbf7f0">' +
    `<link rel="icon" href="${FAVICON}">` +
    (withLoader ? '<link rel="manifest" href="/manifest.webmanifest">' : '') +
    head +
    '<style>' +
    css +
    '</style></head><body>' +
    markup +
    (withLoader ? LOADER : '') +
    '</body></html>'
  );
}

/* -------------------------------------------------------------------- run -- */

const blendsDir = join(out, 'blends');
if (!existsSync(blendsDir)) {
  console.error('FAIL no out/blends directory. Did next build run?');
  process.exit(1);
}

const report = { generatedAt: new Date().toISOString(), documents: [] };
const rewrites = [];
let failed = 0;

function process(file, { slug = null, withLoader = false } = {}) {
  const html = readFileSync(file, 'utf8');
  const { markup, head } = extract(html);

  const rootAttrs = {};
  if (slug) {
    rootAttrs['data-blend'] = slug;
    // Same origin, so navigator.sendBeacon raises no CORS preflight.
    rootAttrs['data-scan-endpoint'] = '/v1/scan-events';
    // Optional after-paint refresh. The baked price is authoritative until this
    // returns. Frozen API contract, section 2.2, open item 5.
    rootAttrs['data-catalog-endpoint'] = '/v1/catalog/';
    rootAttrs['data-sw'] = '1';
  }

  const final = document({ head, markup, rootAttrs, withLoader });

  if (/<script[^>]*\ssrc=/.test(final)) {
    console.error(`FAIL ${relative(out, file)} still contains a script with a src attribute.`);
    failed += 1;
  }
  if (final.includes('/_next')) {
    console.error(`FAIL ${relative(out, file)} still references /_next.`);
    failed += 1;
  }
  if (final.includes('__NEXT_DATA__')) {
    console.error(`FAIL ${relative(out, file)} still contains __NEXT_DATA__.`);
    failed += 1;
  }

  writeFileSync(file, final, 'utf8');

  const raw = Buffer.byteLength(final);
  const compressed = brotli(final);
  const entry = {
    path: `/${relative(out, file).split('\\').join('/')}`,
    rawBytes: raw,
    brotliBytes: compressed,
    inlineCssBytes: Buffer.byteLength(css),
    capBytes: DOCUMENT_BROTLI_CAP,
    withinCap: compressed <= DOCUMENT_BROTLI_CAP,
  };
  report.documents.push(entry);
  if (!entry.withinCap) {
    console.error(
      `FAIL ${entry.path} is ${compressed} bytes Brotli, over the ${DOCUMENT_BROTLI_CAP} byte cap.`,
    );
    failed += 1;
  }
  return entry;
}

for (const name of readdirSync(blendsDir)) {
  if (!name.endsWith('.html')) continue;
  const slug = name.replace(/\.html$/, '');
  process(join(blendsDir, name), { slug, withLoader: true });
  rewrites.push({
    request: `/blend.html?blend=${slug}`,
    originPath: `/blends/${slug}.html`,
  });
}

/* The error and recovery pages carry no loader at all. There is nothing on them
   worth measuring and a beacon on an error page is a beacon with no blend. */
for (const name of ['blend.html', '404.html', 'offline.html']) {
  const file = join(out, name);
  if (existsSync(file)) process(file, {});
}

rmSync(join(out, '_next'), { recursive: true, force: true });

const manifest = {
  generatedAt: report.generatedAt,
  destinationShape: '/blend.html?blend={slug}&via={nfc|qr}',
  note:
    'The 1,000 encoded tags carry treveanspice.com/t/{code} and the edge answers with a 307 to ' +
    'the destination shape above. That destination is a fact, not a design choice. A query ' +
    'parameter cannot select a static file, so the edge rewrites the request URI onto the origin ' +
    'path below in the same viewer-request function that serves the 307. The address bar is ' +
    'unchanged and the customer sees the destination shape.',
  rewrites,
  fallback: {
    originPath: '/blend.html',
    meaning:
      'Served when no rewrite matched. A branded page that says the jar could not be identified, ' +
      'never a redirect to the home page and never a generic landing page.',
  },
  cacheKey: {
    include: ['blend'],
    exclude: ['via', 'utm_*'],
    reason:
      'Including via or utm_* halves the hit ratio and makes the first tap of each variant pay a ' +
      'cold path. The client script still reads via from window.location for the beacon, so the ' +
      'nfc and qr split is not lost.',
  },
  viaParameter: {
    values: ['nfc', 'qr'],
    effectOnPage: 'none',
    reason:
      'The QR code opens the identical page and is the sole recovery route for a sleeping handset, ' +
      'a locked Android and every device outside the matrix. via is read after paint by the ' +
      'beacon and changes nothing a customer sees. The documents served for via=nfc and via=qr ' +
      'are the same bytes.',
    onRedirectPaths:
      'Never read. The route is the path: /t/{code} is the tap and answers via=nfc, /q/{code} is ' +
      'the on-pack QR and answers via=qr. GET /t/{code}?via=qr still answers via=nfc. The edge ' +
      'function reads no query string on any path, which keeps an attacker-supplied value out of ' +
      'the Location header and an attribution value out of the cache key.',
    onBlendPath:
      'GET /blend.html ignores via entirely and it is excluded from the cache key. Including it ' +
      'would halve the hit ratio for an attribution the beacon reads from window.location anyway.',
  },
  qrCode: {
    urlShape: 'https://treveanspice.com/q/{code}',
    reason:
      'The QR resolves through the same code and the same redirect table as the tag, so a blend ' +
      'is repointed in one place and never in two. Pointing the QR straight at /blend.html would ' +
      'work today and would silently stop matching the tag the first time the table is edited, ' +
      'on artwork that cannot be recalled from a printed carton.',
    authority:
      'Informational. The authoritative list is build/edge/dist/qr-artwork.csv, generated from the ' +
      'version-controlled redirect table. Artwork is produced from that sheet, never from a URL ' +
      'retyped out of a document. See the document titled "M1 Deliverable 14: QR attribution", ' +
      'section 4.',
  },
  qrCodes: TAG_CODES.map((t) => ({
    code: t.code.replace('/t/', '/q/'),
    encodeInQr: `https://treveanspice.com${t.code.replace('/t/', '/q/')}`,
    location: `/blend.html?blend=${t.slug}&via=qr`,
    status: 307,
  })),
  tagCodes: TAG_CODES.map((t) => ({
    ...t,
    location: `/blend.html?blend=${t.slug}&via=nfc`,
    status: 307,
    // Whether a pre-rendered page exists for this code's blend. A code whose
    // blend is still a draft resolves to the branded "we could not tell which
    // jar this is" page, which is correct for a reserved code and would be a
    // broken tap for an encoded one. Recorded here so the check is against the
    // build rather than against an assumption.
    resolves: rewrites.some((r) => r.originPath === `/blends/${t.slug}.html`),
  })),
  tagCodesNote:
    'Informational. The authoritative redirect table is version controlled and deployed with the ' +
    'edge function, per decision D10. Five codes exist, four are on physical tags: /t/kg is ' +
    'reserved and was not in this production run. Kyoto Garden is a draft blend, so /t/kg has ' +
    'resolves false and lands on the branded unresolved page. Publishing the blend, or removing ' +
    'the code from the redirect table, are both Trevean decisions.',
  errorPages: {
    unresolvedBlend: '/blend.html',
    notFound: '/404.html',
    offline: '/offline.html',
  },
};

writeFileSync(join(out, 'route-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

/* Whole-output inventory, so the total transfer figure is not a guess. */
function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walk(full));
    else files.push({ path: `/${relative(out, full).split('\\').join('/')}`, bytes: stat.size });
  }
  return files;
}
report.output = walk(out);
report.outputBytes = report.output.reduce((n, f) => n + f.bytes, 0);
writeFileSync(join(out, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log('');
console.log(`Inline CSS       ${Buffer.byteLength(css)} bytes uncompressed / ${INLINE_CSS_CAP} cap`);
console.log('');
console.log('Document                                    raw      brotli   cap      result');
for (const d of report.documents) {
  console.log(
    `  ${d.path.padEnd(40)} ${String(d.rawBytes).padStart(6)}   ${String(d.brotliBytes).padStart(6)}   ${DOCUMENT_BROTLI_CAP}    ${d.withinCap ? 'PASS' : 'FAIL'}`,
  );
}
console.log('');
console.log(`Total output ${(report.outputBytes / 1024).toFixed(1)} KB across ${report.output.length} files.`);
console.log('Wrote out/route-manifest.json and out/build-report.json.');

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
