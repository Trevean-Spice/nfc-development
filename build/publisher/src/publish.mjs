/*
 * The connection between pressing publish and the page a customer sees.
 *
 * The order below is the whole design and each step is where it is for a reason:
 *
 *   1. RENDER, if the job asks for it. Nothing else has happened yet, so a failed render
 *      publishes nothing and the previous version keeps serving.
 *   2. SELECT. Turn the content paths the API queued into object keys. An unrecognised path
 *      selects nothing rather than selecting everything.
 *   3. GUARD. Refuse placeholder content on production, before a single byte moves.
 *   4. DIFF against the published manifest. Objects whose bytes are unchanged are not
 *      re-uploaded and, more importantly, are not invalidated. Invalidating an unchanged
 *      object throws away a warm cache entry and pays for the privilege.
 *   5. PUT the changed objects with the cache headers already in use.
 *   6. MANIFEST. Record what is now published, so the next diff is one small read.
 *   7. INVALIDATE exactly the changed paths. Never the distribution.
 *   8. READ BACK. Fetch the public URL and compare the bytes with what was just published.
 *      This is the only step that proves anything to an editor.
 *
 * Step 8 is what makes the confirmation on the admin publish screen real rather than
 * hopeful. Steps 5 and 7 returning success mean the origin has the object and CloudFront has
 * accepted an invalidation. Neither means a customer's phone gets the new story.
 *
 * The tap path is untouched by all of this. Step 8 reads the same static document a customer
 * reads, through the same cache. No step adds origin compute or a database read to a tap.
 */

import { existsSync } from 'node:fs';
import { enforce as enforcePlaceholderGuard } from './guard.mjs';
import { mark, recomputeTimings } from './jobs.mjs';
import { cachePathFor, selectorsFor, selects } from './paths.mjs';
import { runWebBuild } from './render.mjs';
import { readObject, sha256, walk } from './tree.mjs';

export const MANIFEST_KEY = '_publish/manifest.json';

async function readManifest(store) {
  try {
    const text = await store.getText(MANIFEST_KEY);
    if (!text) return { version: 1, objects: {} };
    const parsed = JSON.parse(text);
    return parsed && typeof parsed.objects === 'object' ? parsed : { version: 1, objects: {} };
  } catch {
    // A manifest that cannot be read means every selected object is treated as changed.
    // That is a slower publish and a larger invalidation, never a missed one.
    return { version: 1, objects: {} };
  }
}

async function writeManifest(store, manifest) {
  const body = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await store.put({
    key: MANIFEST_KEY,
    body,
    contentType: 'application/json; charset=utf-8',
    // The manifest is operational state, not a page. It must never be served from a cache
    // and it is not reachable through the distribution in any case.
    cacheControl: 'no-store',
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read the published document back through the public URL and compare it byte for byte with
 * what was just put in the origin.
 *
 * A version number in the page would be a weaker check, because a page can carry a new
 * version and stale markup. The digest cannot.
 */
export async function confirmLive({ baseUrl, objects, attempts, intervalMs, fetchImpl = fetch }) {
  const documents = objects.filter((o) => o.contentType.startsWith('text/html'));
  if (!baseUrl) {
    return {
      confirmed: false,
      checked: 0,
      url: null,
      detail:
        'No public base URL is configured, so the publisher cannot read the page back. The objects ' +
        'are in the origin and the invalidation was created. Nothing here claims the change is live.',
    };
  }
  if (documents.length === 0) {
    return { confirmed: true, checked: 0, url: null, detail: 'No document changed, so there is nothing to read back.' };
  }

  const outstanding = new Map(documents.map((d) => [d.key, d]));
  const urls = documents.map((d) => new URL(cachePathFor(d.key), baseUrl).toString());
  let lastDetail = null;
  let checked = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    checked = attempt;
    for (const [key, document] of [...outstanding]) {
      const url = new URL(cachePathFor(key), baseUrl).toString();
      try {
        const res = await fetchImpl(url, { headers: { 'cache-control': 'no-cache' } });
        if (!res.ok) {
          lastDetail = `${url} returned HTTP ${res.status}.`;
          continue;
        }
        const served = Buffer.from(await res.arrayBuffer());
        if (sha256(served) === document.sha256) outstanding.delete(key);
        else lastDetail = `${url} is still serving the previous version.`;
      } catch (err) {
        lastDetail = `${url} could not be read back: ${err.message}`;
      }
    }
    if (outstanding.size === 0) {
      return {
        confirmed: true,
        checked,
        url: urls.join(' '),
        detail:
          `The edge is serving the ${documents.length === 1 ? 'document' : `${documents.length} documents`} ` +
          'that were just published, matched on sha256 rather than on a version number, because a page ' +
          'can carry a new version and stale markup and a digest cannot.',
      };
    }
    if (attempt < attempts) await sleep(intervalMs);
  }

  return { confirmed: false, checked, url: urls.join(' '), detail: lastDetail };
}

/**
 * @param {object} job          from jobs.newJob
 * @param {object} deps         {config, store, cdn, fetchImpl}
 */
export async function runPublish(job, { config, store, cdn, fetchImpl = fetch }) {
  job.status = 'running';

  // 1. Render.
  if (config.renderMode === 'build') {
    const result = await runWebBuild({
      webDir: config.webDir,
      contentApiBaseUrl: config.contentApiBaseUrl,
      timeoutMs: config.renderTimeoutMs,
    });
    job.rendered = {
      mode: 'build',
      elapsedMs: result.elapsedMs,
      contentFetchMs: result.fetchMs,
      buildMs: result.buildMs,
      contentApi: config.contentApiBaseUrl || null,
      /*
       * How many reads the render made and the proof that none of them came from a cache.
       * Null when no content API is configured, which is the fixtures case the deployment
       * guard refuses on production. This is recorded rather than merely asserted because
       * the assertion happens once, inside the render, and an editor asking later why they
       * should believe the page is their words deserves the answer in the job record.
       */
      contentRead: result.contentRead,
    };
  } else {
    job.rendered = { mode: 'prebuilt', elapsedMs: 0 };
  }
  if (!existsSync(config.renderDir)) {
    throw new Error(`the render directory ${config.renderDir} does not exist, so there is nothing to publish.`);
  }
  mark(job, 'renderedAtMs');

  // 2. Select.
  const selectors = selectorsFor(job.paths);
  const everything = walk(config.renderDir);
  const selectedKeys = everything.filter((key) => selects(selectors, key));
  if (selectedKeys.length === 0) {
    throw new Error(
      `none of the queued paths matched a rendered object. Queued: ${job.paths.join(', ')}. ` +
        'Nothing was published, which is the correct outcome for a path that does not exist.',
    );
  }
  const objects = selectedKeys.map((key) => readObject(config.renderDir, key));

  // 3. Guard. Before a single byte moves.
  const guard = enforcePlaceholderGuard({ stage: config.stage, objects, contentDir: config.contentDir });
  job.placeholder = { objects: guard.placeholderObjects, note: guard.note };

  // 4. Diff.
  const manifest = await readManifest(store);
  const changed = [];
  const unchanged = [];
  for (const object of objects) {
    if (manifest.objects[object.key]?.sha256 === object.sha256) unchanged.push(object.key);
    else changed.push(object);
  }
  job.unchanged = unchanged;

  // 5. Put.
  for (const object of changed) {
    await store.put({
      key: object.key,
      body: object.body,
      contentType: object.contentType,
      cacheControl: object.cacheControl,
    });
    manifest.objects[object.key] = {
      sha256: object.sha256,
      bytes: object.bytes,
      cacheControl: object.cacheControl,
      contentType: object.contentType,
      publishedAt: new Date().toISOString(),
      revalidationId: job.revalidationId,
    };
    job.published.push({
      key: object.key,
      bytes: object.bytes,
      sha256: object.sha256,
      cacheControl: object.cacheControl,
      contentType: object.contentType,
    });
  }

  // 6. Manifest.
  if (changed.length > 0) {
    manifest.version = 1;
    manifest.updatedAt = new Date().toISOString();
    await writeManifest(store, manifest);
  }

  // 7. Invalidate exactly the changed paths.
  if (changed.length > 0) {
    const paths = changed.map((object) => cachePathFor(object.key));
    job.invalidation = await cdn.createInvalidation(paths);
  } else {
    job.invalidation = {
      invalidationId: null,
      paths: [],
      note:
        'No object changed, so nothing was invalidated. An invalidation of an unchanged object ' +
        'throws away a warm cache entry and is billed for it.',
    };
  }
  mark(job, 'publishedAtMs');

  // 8. Read back.
  job.live = await confirmLive({
    baseUrl: config.cdn.publicBaseUrl,
    objects: changed,
    attempts: config.verify.attempts,
    intervalMs: config.verify.intervalMs,
    fetchImpl,
  });
  if (job.live.confirmed) mark(job, 'liveAtMs');

  job.status = job.live.confirmed ? 'complete' : 'published_unconfirmed';
  recomputeTimings(job);
  return job;
}
