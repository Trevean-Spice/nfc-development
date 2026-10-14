/*
 * The stand in edge. CloudFront, minus everything that is not load bearing for a publish.
 *
 * It exists so that "publish to live" can be measured end to end on a laptop with expired
 * credentials, which has been this project's normal condition. It reproduces the four
 * behaviours a publish actually depends on:
 *
 *   1. It serves objects out of the stand in bucket, with the Cache-Control and Content-Type
 *      THE PUBLISHER STORED, read from the object's metadata rather than re-derived. A wrong
 *      header is then visible here rather than in production.
 *   2. It caches. A published object is held under its path and served from that hold until
 *      it is invalidated. An edge that always read through would make every publish look
 *      instantly live and would hide the one step that is not instant.
 *   3. It is invalidated by path, exactly, through /_stand-in/invalidate. A path that was not
 *      invalidated keeps serving the old bytes, which is the defect an editor would otherwise
 *      find on a customer's phone.
 *   4. It rewrites /blend.html?blend={slug} onto /blends/{slug}.html at viewer request, which
 *      is where the real CloudFront Function runs, so the cache key carries the rewritten uri
 *      here for the same reason it does there.
 *
 * IT IS NOT MORE PERMISSIVE THAN THE REAL THING. It refuses a request for an object that has
 * not been published, it refuses a rewrite onto a slug that has no built page, and it never
 * invents a header. A local server that is more permissive than production does not save
 * time, it converts a loud failure into a silent one.
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const META_SUFFIX = '.trevean-meta.json';

export function createStandInEdge({ root, propagationMs = 0 }) {
  const siteRoot = resolve(root);
  const cache = new Map();

  const fileFor = (key) => {
    const full = resolve(join(siteRoot, ...key.split('/')));
    if (full !== siteRoot && !full.startsWith(siteRoot + sep)) return null;
    return full;
  };

  const load = (key) => {
    const file = fileFor(key);
    if (!file || !existsSync(file) || !existsSync(`${file}${META_SUFFIX}`)) return null;
    return { body: readFileSync(file), meta: JSON.parse(readFileSync(`${file}${META_SUFFIX}`, 'utf8')) };
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'edge'}`);

    if (req.method === 'POST' && url.pathname === '/_stand-in/invalidate') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let paths = [];
        try {
          paths = JSON.parse(Buffer.concat(chunks).toString('utf8')).paths ?? [];
        } catch {
          res.writeHead(400).end();
          return;
        }
        const apply = () => {
          for (const path of paths) cache.delete(path);
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ invalidated: paths }));
        };
        if (propagationMs > 0) setTimeout(apply, propagationMs);
        else apply();
      });
      return;
    }

    // Viewer request rewrite. The real one is a CloudFront Function on the /blend.html
    // behaviour and it matches against an allowlist rather than interpolating the slug into
    // a path, so a crafted slug cannot reach an arbitrary object. So does this.
    let key = url.pathname.replace(/^\//, '');
    if (url.pathname === '/blend.html') {
      const slug = url.searchParams.get('blend');
      if (slug && /^[a-z0-9-]+$/.test(slug) && load(`blends/${slug}.html`)) key = `blends/${slug}.html`;
    }
    if (key === '') key = 'index.html';

    const cachePath = `/${key}`;
    let entry = cache.get(cachePath);
    let hit = true;
    if (!entry) {
      hit = false;
      const object = load(key);
      if (!object) {
        // The branded unresolved document, never a bare 403 or a generic landing page.
        const fallback = load('blend.html');
        if (!fallback) {
          res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Not found');
          return;
        }
        res
          .writeHead(404, { 'Content-Type': fallback.meta.contentType, 'Cache-Control': 'no-store' })
          .end(req.method === 'HEAD' ? undefined : fallback.body);
        return;
      }
      entry = object;
      cache.set(cachePath, entry);
    }

    res.writeHead(200, {
      'Content-Type': entry.meta.contentType,
      'Cache-Control': entry.meta.cacheControl,
      'Content-Length': entry.body.length,
      'X-Content-Type-Options': 'nosniff',
      'Server-Timing': `edge;desc="${hit ? 'HIT' : 'MISS'}"`,
    });
    res.end(req.method === 'HEAD' ? undefined : entry.body);
  });

  server.trevean = { cache };
  return server;
}

if (process.argv[1] && process.argv[1].endsWith('stand-in-edge.mjs')) {
  const root = process.env.PUBLISHER_LOCAL_SITE_DIR ?? resolve('.local-site');
  const port = Number.parseInt(process.env.STAND_IN_EDGE_PORT ?? '3004', 10);
  createStandInEdge({ root }).listen(port, '127.0.0.1', () => {
    process.stdout.write(`stand in edge on http://127.0.0.1:${port} serving ${root}\n`);
  });
}
