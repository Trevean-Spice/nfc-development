#!/usr/bin/env node
/*
 * The acceptance criterion, measured rather than asserted.
 *
 *   "Content editable end to end without a developer, changes live within 5 minutes."
 *
 * This drives the real path with no AWS and no mocks of anything on it: it edits a blend
 * through the API exactly as the admin does, presses publish, and then waits for the edited
 * words to appear on the document the customer's URL serves, through a cache that was warm
 * before the edit. The clock runs from the publish request to the moment the new words are
 * readable at the edge, which is the editor's number and the contractual one.
 *
 * It is not part of `npm test`. It needs two other processes and it takes minutes, and a
 * suite that goes red because a second process is not running teaches people to ignore red.
 *
 * Run it like this, in three terminals:
 *
 *   1  cd build/api
 *      SECRET_TREVEAN_API_DEV_JWT_SECRET=dev-jwt-secret \
 *      SECRET_TREVEAN_API_REVALIDATION_SECRET=dev-revalidation-secret \
 *      REVALIDATION_WEBHOOK_URL=http://127.0.0.1:3003/revalidate npm run local:up
 *
 *   2  cd build/publisher
 *      STAGE=local PUBLISH_TARGET=local PUBLISHER_RENDER_MODE=build \
 *      TREVEAN_CONTENT_API=http://127.0.0.1:3001 \
 *      REVALIDATION_SECRET=dev-revalidation-secret \
 *      PUBLISHER_PUBLIC_BASE_URL=http://127.0.0.1:3004 npm start
 *
 *   3  cd build/publisher
 *      STAND_IN_EDGE_PORT=3004 PUBLISHER_LOCAL_SITE_DIR=./.local-site npm run stand-in
 *
 *   4  node scripts/measure-publish-to-live.mjs
 */

import { createHmac } from 'node:crypto';

const API = process.env.TREVEAN_CONTENT_API ?? 'http://127.0.0.1:3001';
const PUBLISHER = process.env.PUBLISHER_BASE_URL ?? 'http://127.0.0.1:3003';
const EDGE = process.env.PUBLISHER_PUBLIC_BASE_URL ?? 'http://127.0.0.1:3004';
const SLUG = process.env.MEASURE_SLUG ?? 'persian-sunrise';
const DEV_JWT_SECRET = process.env.API_DEV_JWT_SECRET ?? 'dev-jwt-secret';
const ISSUER = process.env.AUTH_ISSUER ?? 'https://auth.local.treveanspice.com';
const AUDIENCE = process.env.AUTH_AUDIENCE ?? 'trevean-admin';

const b64 = (value) => Buffer.from(value).toString('base64url');

/** The same shape build/admin mints, with the same symmetric development key the API accepts. */
function mintEditorToken() {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64(
    JSON.stringify({
      sub: 'measure-publish-to-live',
      email: 'editor@treveanspice.com',
      roles: ['Editor'],
      iss: ISSUER,
      aud: AUDIENCE,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = createHmac('sha256', DEV_JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const token = mintEditorToken();
const authed = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

process.stdout.write(`api        ${API}\npublisher  ${PUBLISHER}\nedge       ${EDGE}\nblend      ${SLUG}\n\n`);

// 0. Warm the edge cache the way a customer's tap does, so the measurement includes an
//    invalidation that has to actually take effect rather than a cold miss that reads through.
const warm = await fetch(`${EDGE}/blend.html?blend=${SLUG}`);
process.stdout.write(`warm read: HTTP ${warm.status}, ${warm.headers.get('server-timing')}\n`);

// 1. The edit. This is what a member of the marketing team types.
const current = await json(await fetch(`${API}/v1/admin/blends/${SLUG}`, { headers: authed }));
const marker = `Edited by the publish to live measurement at ${new Date().toISOString()}`;
/*
 * The origin story, not the tagline. The tagline reaches only the meta description on a
 * blend whose content is real, so an edit to it is invisible on a placeholder page and the
 * measurement would be measuring nothing. This is the field a marketing person edits and it
 * is on the page above the fold.
 */
const patched = await fetch(`${API}/v1/admin/blends/${SLUG}`, {
  method: 'PATCH',
  headers: { ...authed, 'if-match': String(current.version) },
  body: JSON.stringify({
    version: current.version,
    tagline: marker,
    storyBlocks: [
      { type: 'heading', text: 'Where Persian Sunrise comes from' },
      { type: 'paragraph', text: marker },
    ],
  }),
});
if (!patched.ok) {
  process.stderr.write(`the edit failed: HTTP ${patched.status} ${JSON.stringify(await json(patched))}\n`);
  process.exit(1);
}
process.stdout.write(`edit:      version ${current.version} -> ${(await json(patched)).version}\n`);

// 2. Press publish. The clock starts here.
const startedAt = Date.now();
const publishRes = await fetch(`${API}/v1/admin/blends/${SLUG}/publish`, { method: 'POST', headers: authed, body: '{}' });
const publish = await json(publishRes);
if (publishRes.status !== 202) {
  process.stderr.write(`publish failed: HTTP ${publishRes.status} ${JSON.stringify(publish)}\n`);
  process.exit(1);
}
process.stdout.write(`publish:   202, revalidationId ${publish.revalidationId}, paths ${publish.paths.join(' ')}\n`);

// 3. Wait for the words to appear at the edge. Not for a status, for the words.
let liveAt = null;
let lastStatus = null;
const deadline = startedAt + 300000;
while (Date.now() < deadline) {
  const served = await fetch(`${EDGE}/blend.html?blend=${SLUG}`, { headers: { 'cache-control': 'no-cache' } });
  if (served.ok && (await served.text()).includes(marker)) {
    liveAt = Date.now();
    break;
  }
  const job = await json(await fetch(`${PUBLISHER}/revalidations/${publish.revalidationId}`));
  if (job.status && job.status !== lastStatus) {
    lastStatus = job.status;
    process.stdout.write(`           publisher: ${job.status} at +${((Date.now() - startedAt) / 1000).toFixed(1)} s\n`);
  }
  if (job.status === 'failed') {
    process.stderr.write(`the publish failed: ${JSON.stringify(job.failure, null, 2)}\n`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1000));
}

const job = await json(await fetch(`${PUBLISHER}/revalidations/${publish.revalidationId}`));

if (liveAt === null) {
  process.stderr.write(`\nNOT LIVE within 300000 ms. Publisher job:\n${JSON.stringify(job, null, 2)}\n`);
  process.exit(1);
}

const elapsed = liveAt - startedAt;
process.stdout.write(
  `\nPUBLISH TO LIVE: ${elapsed} ms (${(elapsed / 1000).toFixed(1)} s) against a 300000 ms requirement\n` +
    `  render         ${job.rendered ? `${job.rendered.elapsedMs} ms (${job.rendered.mode})` : 'n/a'}\n` +
    `  published      ${job.published.map((o) => o.path).join(' ')}\n` +
    `  invalidated    ${(job.invalidation?.paths ?? []).join(' ') || 'nothing'}\n` +
    `  placeholder    ${job.placeholder.objects.length} object(s)\n` +
    `  margin         ${(300000 - elapsed) / 1000} s\n`,
);
process.exit(elapsed <= 300000 ? 0 : 1);
