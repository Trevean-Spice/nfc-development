#!/usr/bin/env node
/**
 * A local stand-in for the edge, so the tap path can be measured before the
 * CloudFront distribution exists.
 *
 * It reproduces exactly the four behaviours the measurement depends on, and
 * nothing else. It is a measuring rig, not a production server, and it is not
 * the deployment target.
 *
 *   1. GET /t/{code} returns 307 with a relative Location and no-store.
 *      307, not 301: a 301 is cached by browsers, in some cases indefinitely,
 *      which would make the destination permanently un-editable on every device
 *      that had ever tapped a jar. That destroys the reason the redirect exists.
 *
 *   2. GET /blend.html?blend={slug} is rewritten onto /blends/{slug}.html.
 *      A query parameter cannot select a static file. The rewrite is the same
 *      one the viewer-request function performs in production, generated from
 *      out/route-manifest.json rather than typed twice.
 *
 *   3. via and utm_* are ignored entirely, on every path. On /blend.html that
 *      is what excluding them from the cache key looks like from the page's
 *      side: via=nfc and via=qr return the same bytes. On the redirect paths it
 *      is stricter than that, because the canonical edge function never reads a
 *      query string at all. The on-pack QR is a separate path, /q/{code}, which
 *      resolves through the same code and the same table as the tag and 307s to
 *      the same destination page carrying via=qr. See the document titled "M1
 *      Deliverable 14: QR attribution", section 2.
 *
 *   4. Server-Timing: edge;desc="HIT" is set, because a response header is not
 *      otherwise visible to the page and without it the field beacon reports
 *      edgeCache "unknown", losing the earliest warning that something broke
 *      the rendering strategy.
 *
 * Usage: node scripts/serve.mjs [port]
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'out');
const port = Number(process.argv[2] || 3000);

const manifest = JSON.parse(readFileSync(join(out, 'route-manifest.json'), 'utf8'));

const redirectTable = new Map(
  manifest.tagCodes.map((t) => [t.code.replace(/^\/t\//, ''), t.location]),
);
const qrTable = new Map(
  manifest.qrCodes.map((q) => [q.code.replace(/^\/q\//, ''), q.location]),
);
const rewriteTable = new Map(
  manifest.rewrites.map((r) => [new URL(r.request, 'http://x').searchParams.get('blend'), r.originPath]),
);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.json', '.webmanifest', '.css', '.svg']);
const cache = new Map();

function bodyFor(file, encoding) {
  const key = `${file}|${encoding}`;
  if (cache.has(key)) return cache.get(key);
  const raw = readFileSync(file);
  let body = raw;
  if (encoding === 'br') {
    body = brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } });
  } else if (encoding === 'gzip') {
    body = gzipSync(raw, { level: 9 });
  }
  cache.set(key, body);
  return body;
}

function pickEncoding(accept, ext) {
  if (!COMPRESSIBLE.has(ext)) return null;
  const value = (accept || '').toLowerCase();
  if (value.includes('br')) return 'br';
  if (value.includes('gzip')) return 'gzip';
  return null;
}

function sendFile(req, res, file, status = 200, extraHeaders = {}) {
  const ext = extname(file).toLowerCase();
  const encoding = pickEncoding(req.headers['accept-encoding'], ext);
  const body = bodyFor(file, encoding);

  const headers = {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Content-Length': body.length,
    // "M1 Deliverable 3", section 5, "Cache-control": long at the CDN, short in
    // the browser, invalidated on publish.
    'Cache-Control':
      ext === '.html'
        ? 'public, max-age=60, s-maxage=31536000, stale-while-revalidate=86400'
        : 'public, max-age=31536000, immutable',
    'Server-Timing': 'edge;desc="HIT"',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  };
  if (encoding) headers['Content-Encoding'] = encoding;
  headers.Vary = 'Accept-Encoding';

  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function notFound(req, res) {
  const file = join(out, '404.html');
  if (existsSync(file)) return sendFile(req, res, file, 404, { 'Cache-Control': 'no-store' });
  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
}

/* Two API stubs, so the after-paint half of the page is exercised for real
   during measurement instead of measuring a pair of 404s. They answer exactly
   what the frozen API contract says they answer and nothing more. */
const received = [];

/*
 * ScanEventInput, transcribed from the frozen API contract, version 1.0.0.
 *
 * THIS STUB VALIDATES, AND THAT IS THE POINT OF IT.
 *
 * It used to accept any JSON it could parse and log it. That is how the blend
 * page came to post the measurement harness's own record here, be answered 202
 * on every run, and go undetected: the real API sets additionalProperties false
 * on this schema and answers 400, so in production every customer tap would have
 * been rejected and the scan count would have been zero with nothing in any
 * dashboard saying so. A local server more permissive than production does not
 * save anybody time, it converts a loud failure into a silent one.
 *
 * So the rule here is: refuse anything the real API would refuse. This
 * transcription is checked by npm run verify, which posts both a valid body and
 * the old harness-shaped body and asserts 202 and 400. The frozen OpenAPI
 * document governs; where this disagrees with it, this is the defect. It is
 * transcribed rather than loaded because this package has no dependencies, no
 * YAML parser, and ships to a repository that does not contain the contract.
 */
const SCAN_EVENT_SCHEMA = {
  required: ['blendSlug', 'channel', 'dedupToken', 'occurredAt'],
  properties: {
    blendSlug: {
      enum: ['persian-sunrise', 'caribbean-sunset', 'north-african-night-market', 'silk-road', 'kyoto-garden'],
    },
    tagCode: { enum: ['ps', 'cs', 'sr', 'nm', 'kg', null] },
    channel: { enum: ['nfc', 'qr', 'direct'] },
    dedupToken: { pattern: /^[0-9a-f]{32}$/ },
    occurredAt: { pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/ },
    platform: { enum: ['ios', 'android', 'other'] },
    deviceFamily: { string: true, maxLength: 40, nullable: true },
    connectionType: { enum: ['slow-2g', '2g', '3g', '4g', '5g', 'wifi', 'unknown'] },
    cacheStatus: { enum: ['hit', 'miss', 'stale', 'unknown'] },
    ttfbMs: { integer: true, minimum: 0, maximum: 120000, nullable: true },
    timeToReadableMs: { integer: true, minimum: 0, maximum: 120000, nullable: true },
    pageVersion: { integer: true, minimum: 1, maximum: 2147483647, nullable: true },
    redirected: { boolean: true, nullable: true },
  },
};

/** One entry per offending field, the same shape as the API error envelope. */
function validateScanEvent(body) {
  const details = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return [{ field: '(body)', issue: 'not_an_object' }];
  }
  for (const field of SCAN_EVENT_SCHEMA.required) {
    if (!(field in body)) details.push({ field, issue: 'required' });
  }
  for (const field of Object.keys(body)) {
    const rule = SCAN_EVENT_SCHEMA.properties[field];
    // additionalProperties: false. The beacon accepts no free text and no
    // identifiers of value, so an unexpected field is a rejection, not a shrug.
    if (!rule) {
      details.push({ field, issue: 'unknown_field' });
      continue;
    }
    const value = body[field];
    if (value === null) {
      if (!rule.nullable && !(rule.enum && rule.enum.indexOf(null) !== -1)) {
        details.push({ field, issue: 'type_mismatch' });
      }
      continue;
    }
    if (rule.enum && rule.enum.indexOf(value) === -1) details.push({ field, issue: 'not_in_enum' });
    if (rule.pattern && !(typeof value === 'string' && rule.pattern.test(value))) {
      details.push({ field, issue: 'pattern_mismatch' });
    }
    if (rule.string && typeof value !== 'string') details.push({ field, issue: 'type_mismatch' });
    if (rule.string && typeof value === 'string' && value.length > rule.maxLength) {
      details.push({ field, issue: 'too_long' });
    }
    if (rule.boolean && typeof value !== 'boolean') details.push({ field, issue: 'type_mismatch' });
    if (rule.integer) {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        details.push({ field, issue: 'type_mismatch' });
      } else if (value < rule.minimum || value > rule.maximum) {
        details.push({ field, issue: 'out_of_range' });
      }
    }
  }
  return details;
}

function apiStub(req, res, url) {
  // POST /v1/scan-events: 202 with an empty body for a well formed request, and
  // also 202 for a duplicate. The client cannot distinguish the two and must
  // not try. Frozen API contract, section 4.2. A body the real API would reject
  // is a 400 here too, with the same envelope, so a wire format defect surfaces
  // during measurement rather than after launch.
  if (url.pathname === '/v1/scan-events' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let event = null;
      let details;
      try {
        event = JSON.parse(body);
        details = validateScanEvent(event);
      } catch {
        details = [{ field: '(body)', issue: 'malformed_json' }];
      }

      if (details.length > 0) {
        const envelope = JSON.stringify({
          error: {
            code: event === null ? 'MALFORMED_JSON' : 'VALIDATION_FAILED',
            message: `${details.length} field${details.length === 1 ? '' : 's'} failed validation.`,
            requestId: 'local-stand-in',
            details,
          },
        });
        console.error(`  beacon REJECTED, ${details.length} validation failures:`);
        for (const detail of details) console.error(`    ${detail.field}: ${detail.issue}`);
        return res
          .writeHead(400, {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(envelope),
          })
          .end(envelope);
      }

      received.push(event);
      console.log(
        `  scan event ${received.length}: blendSlug=${event.blendSlug} channel=${event.channel} ` +
          `dedupToken=${event.dedupToken} readable=${event.timeToReadableMs}ms ` +
          `redirected=${event.redirected} cacheStatus=${event.cacheStatus} platform=${event.platform}`,
      );
      // A log of accepted ScanEventInput bodies, which is what the wire carries.
      // It is NOT a trevean-field-beacon/1 file: the analysis reads records, and
      // a record capture is a beacon configured with wireFormat harness-record
      // against a rig endpoint, never against this one.
      if (process.env.TREVEAN_SCAN_EVENT_LOG) {
        appendFileSync(process.env.TREVEAN_SCAN_EVENT_LOG, `${JSON.stringify(event)}\n`);
      }
      res.writeHead(202, { 'Cache-Control': 'no-store', 'Content-Length': 0 }).end();
    });
    return true;
  }

  // GET /v1/catalog/{slug}: the optional after-paint price refresh. Degradable
  // by design, which is why the page bakes a price in at build time.
  if (url.pathname.startsWith('/v1/catalog/') && req.method === 'GET') {
    const body = JSON.stringify({
      slug: url.pathname.replace('/v1/catalog/', ''),
      price: null,
      available: null,
      note: 'Local stub. Real catalog values come from the Shopify mirror.',
    });
    res
      .writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=600',
        'Content-Length': Buffer.byteLength(body),
      })
      .end(body);
    return true;
  }
  return false;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = decodeURIComponent(url.pathname);

  if (path.startsWith('/v1/') && apiStub(req, res, url)) return;

  // 1. The two redirect paths, /t/{code} for the tap and /q/{code} for the
  //    on-pack QR. Lowercased, trailing slashes stripped, then looked up. The
  //    route is decided by the path and by nothing else: the query string is
  //    never read here, exactly as it is never read by the CloudFront Function,
  //    which is what keeps an attacker-supplied value out of the Location header
  //    and an attribution value out of the cache key.
  const lowered = path.toLowerCase();
  if (lowered.startsWith('/t/') || lowered.startsWith('/q/')) {
    const table = lowered.startsWith('/q/') ? qrTable : redirectTable;
    const code = lowered.slice(3).replace(/\/+$/, '');
    const location = table.get(code);
    if (!location) return notFound(req, res);
    res.writeHead(307, {
      Location: location,
      'Cache-Control': 'no-store',
      'Content-Length': 0,
      // "M1 Deliverable 3", section 3, note C: a preload hint on the 307 starts
      // the hero fetch a full round trip earlier and is the only way to make
      // the redirect hop do useful work.
      Link: `<${heroFor(location)}>; rel=preload; as=image; fetchpriority=high`,
    });
    return res.end();
  }

  // 2. The destination shape, rewritten onto a pre-rendered file.
  if (path === '/blend.html') {
    const slug = url.searchParams.get('blend');
    const target = slug ? rewriteTable.get(slug) : null;
    if (target) return sendFile(req, res, join(out, target.replace(/^\//, '')));
    // No rewrite matched. Branded, honest, and a 404 so it is never mistaken
    // for a working page by a monitor.
    return sendFile(req, res, join(out, 'blend.html'), 404, { 'Cache-Control': 'no-store' });
  }

  const candidate = normalize(join(out, path)).replace(/[\\/]+$/, '');
  if (!candidate.startsWith(normalize(out))) return notFound(req, res);
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return sendFile(req, res, candidate);
  }
  return notFound(req, res);
});

/** The largest AVIF variant for the blend the 307 points at. */
function heroFor(location) {
  const slug = new URL(location, 'http://x').searchParams.get('blend');
  return `/media/${slug}/hero-1280.avif`;
}

server.listen(port, () => {
  console.log(`Edge stand-in on http://localhost:${port}`);
  console.log('');
  for (const [code, location] of redirectTable) {
    console.log(`  /t/${code.padEnd(3)} 307 -> ${location}`);
  }
  for (const [code, location] of qrTable) {
    console.log(`  /q/${code.padEnd(3)} 307 -> ${location}`);
  }
  console.log('');
  console.log('  /blend.html?blend={slug}  rewritten to /blends/{slug}.html');
  console.log('  via and utm_* never read, on any path');
});
