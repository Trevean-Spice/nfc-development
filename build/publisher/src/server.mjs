/*
 * The publisher's front door. Two routes and a health check, on Node's own HTTP server,
 * because a service whose job is to ship other people's code should not be the one adding a
 * web framework to the dependency list.
 *
 *   POST /revalidate                    the signed job from build/api. 202, never waits.
 *   GET  /revalidations/{id}            what happened, and how long it took.
 *   GET  /health
 *
 * WHY /revalidations/{id} IS HERE AND NOT ON THE API, because this is exactly the sort of
 * thing that looks like an invented endpoint if it is not explained.
 *
 * The frozen API contract, section 10.2, says the publish response is "202 with a status
 * URL". The PublishResult schema has no such field and no operation in the document reads
 * the state of a revalidationId, so there is no contract legal way to ask the API whether a
 * revalidation finished. The contract errata records this as E9 gap 4 and recommends adding
 * `GET /v1/admin/revalidations/{revalidationId}` at minimum role Viewer, which is additive
 * and permitted inside v1. That change needs Dan, and it is not ours to make: the contract
 * is frozen and vendored byte identical into two packages with a test asserting it.
 *
 * So the status lives here, on the publisher, which is not the API and is not described by
 * the contract at all, exactly as the Shopify webhook consumers live outside /v1 under
 * section 5.4. Nothing invents a /v1 operation and no client of the frozen document sees a
 * surface the document does not describe. When the erratum is approved, this moves behind
 * the API and the admin changes one base URL.
 *
 * POST /revalidate answers 202 and returns immediately. The work runs after the response,
 * because publish does not wait for revalidation: the previous version keeps serving until
 * the new one is ready, which is the whole point of the rendering strategy.
 */

import { createServer } from 'node:http';
import { JobStore, newJob, toWire } from './jobs.mjs';
import { runPublish } from './publish.mjs';
import { PublishQueue } from './queue.mjs';
import { SIGNATURE_HEADER, verify } from './signature.mjs';

const MAX_BODY_BYTES = 65536;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error(`the request body is larger than ${MAX_BODY_BYTES} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  const body = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

/**
 * @param {object} options {config, store, cdn, secret, jobs, fetchImpl, onSettled}
 */
export function createPublisherServer(options) {
  const { config, store, cdn, secret, fetchImpl } = options;
  const jobs = options.jobs ?? new JobStore(config.jobRetention);

  /*
   * ONE PUBLISH AT A TIME. Two renders in one working directory write each other's `.next`
   * and `out`, and two publishes interleaved leave a manifest describing neither. See
   * queue.mjs for the whole argument. Jobs that arrive during a render wait for the next one
   * and then share it.
   */
  const queue =
    options.queue ??
    new PublishQueue({
      run: (job) => runPublish(job, { config, store, cdn, fetchImpl }),
    });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'publisher'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { status: 'ok', stage: config.stage, target: config.target, store: store.name, cdn: cdn.name });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/revalidations/')) {
      const id = decodeURIComponent(url.pathname.slice('/revalidations/'.length));
      const job = jobs.get(id);
      if (!job) {
        send(res, 404, {
          error: {
            code: 'REVALIDATION_NOT_FOUND',
            message:
              `No publish job with id ${id} is held by this publisher. Job records are in memory and ` +
              'are lost on restart, so an unknown id means either a restart or a job that was never dispatched.',
          },
        });
        return;
      }
      send(res, 200, toWire(job));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/revalidate') {
      let raw;
      try {
        raw = await readBody(req);
      } catch (err) {
        send(res, 413, { error: { code: 'BODY_TOO_LARGE', message: err.message } });
        return;
      }

      const signature = verify(raw, req.headers[SIGNATURE_HEADER], secret);
      if (!signature.ok) {
        // 401 and not 400. The body is never parsed before the signature is checked.
        send(res, 401, {
          error: {
            code: 'SIGNATURE_INVALID',
            message: `The revalidation was refused because ${signature.reason}`,
          },
        });
        return;
      }

      let body;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        send(res, 400, { error: { code: 'MALFORMED_BODY', message: 'The request body is not JSON.' } });
        return;
      }

      if (!body.revalidationId || !Array.isArray(body.paths) || body.paths.length === 0) {
        send(res, 400, {
          error: {
            code: 'MALFORMED_BODY',
            message: 'A revalidation needs a revalidationId and at least one path.',
          },
        });
        return;
      }

      const job = jobs.put(
        newJob({
          revalidationId: body.revalidationId,
          paths: body.paths,
          reason: body.reason ?? null,
          requestedBy: body.requestedBy ?? null,
          stage: config.stage,
          target: config.target,
        }),
      );

      send(res, 202, {
        revalidationId: job.revalidationId,
        status: job.status,
        paths: job.paths,
        statusUrl: `/revalidations/${encodeURIComponent(job.revalidationId)}`,

        // Said in the 202 rather than only in the job record, because "another publish is
        // rendering, yours starts after it" is the difference between a slow publish and a
        // stuck one, and the editor is looking at the screen now.
        waitingForARenderInFlight: queue.busy,
      });

      queue.submit(job).then((settled) => options.onSettled?.(settled));
      return;
    }

    send(res, 404, { error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${url.pathname}.` } });
  });

  server.trevean = { jobs, queue, settle: () => queue.settle() };
  return server;
}
