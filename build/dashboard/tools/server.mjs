/**
 * A static file server for public/, with two extra jobs.
 *
 * 1. It proxies /v1 to the API. Same origin, so there is no CORS configuration anywhere and
 *    the API package is not modified to accommodate a browser that is meant to be served
 *    from the same distribution in production anyway.
 * 2. It serves a Viewer token at /dev/token, and only when the local stack asked it to.
 *    There is no identity provider on a laptop. In any real environment the dashboard sits
 *    behind the same provider as the admin CMS and this route does not exist.
 *
 * Nothing here is deployed. The deployed dashboard is the contents of public/ behind the
 * CDN, with the API reached at the same origin by path.
 */

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = resolve(here, '../public');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  // normalize plus a prefix check, so a path cannot climb out of public/.
  const filePath = join(PUBLIC_DIR, normalize(requested).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(filePath).pipe(response);
}

function proxy(request, response, apiBaseUrl) {
  const target = new URL(request.url, apiBaseUrl);
  const upstream = http.request(
    {
      host: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: request.method,
      headers: { ...request.headers, host: target.host },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on('error', (error) => {
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        error: { code: 'UPSTREAM_UNAVAILABLE', message: `The API could not be reached: ${error.message}`, requestId: 'local' },
      }),
    );
  });
  request.pipe(upstream);
}

export function createDashboardServer({ apiBaseUrl, devToken = null }) {
  return http.createServer((request, response) => {
    if (request.url.startsWith('/v1/')) {
      proxy(request, response, apiBaseUrl);
      return;
    }
    if (request.url === '/dev/token') {
      if (devToken === null) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('No development token is served here.');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ token: devToken, role: 'Viewer', note: 'Local development only.' }));
      return;
    }
    serveStatic(request, response);
  });
}
