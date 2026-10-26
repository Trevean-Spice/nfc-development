/**
 * The Tag Tool's web server: one page, a live feed of the state, and three buttons.
 *
 * Node's own http module, nothing third party. It listens on 127.0.0.1 and nowhere
 * else, and that address is a constant in this file rather than an option, so no
 * flag, setting or environment variable can put it on a network. The tests connect
 * to it over every other local address the machine has and require each to fail.
 *
 * Being on loopback keeps other computers out. It does not keep other web pages
 * out: any site open in the same browser can send a request to 127.0.0.1. So:
 *
 *   - the Host header must name this server (127.0.0.1 or localhost, this port),
 *     which is what defeats a DNS rebinding page;
 *   - a POST must be JSON, which a plain cross site form cannot send without the
 *     browser first asking permission this server never gives;
 *   - a POST that says where it came from must have come from this page.
 *
 * The page is served with a content security policy that lets it load its own
 * script and talk to this server and nothing else.
 */

import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { isChipError } from '../chip/errors.js';
import { AppRefusal, type TagToolController } from './controller.js';
import type { BenchSimulator } from './bench-simulator.js';

/** Loopback only. Deliberately not configurable. */
export const HOST = '127.0.0.1';

/**
 * The address the operator never needs to know. The first free one is used; the
 * launcher opens the browser on it. Ten in a row so a stuck earlier copy, or some
 * other program, on the first does not stop the tool starting.
 */
export const DEFAULT_PORTS: readonly number[] = Array.from({ length: 10 }, (_, i) => 10350 + i);

const HERE = dirname(fileURLToPath(import.meta.url));
/** From dist/src/app back to the package root, then to the page sources, which tsc does not copy. */
export const STATIC_DIR = resolve(HERE, '..', '..', '..', 'src', 'app');

const MAX_BODY_BYTES = 4096;
const HEARTBEAT_MS = 15_000;

export interface ServerOptions {
  readonly controller: TagToolController;
  /** Present only when running against the bench simulator. Enables /api/sim. */
  readonly bench?: BenchSimulator | null;
  /** Tried in order. */
  readonly ports: readonly number[];
  /** When every port in the list is taken, let the operating system pick one. */
  readonly allowAnyPort?: boolean;
}

export interface RunningServer {
  readonly url: string;
  readonly port: number;
  readonly address: string;
  readonly server: Server;
  close(): Promise<void>;
}

const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

const PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function send(res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra });
  res.end(body);
}

function json(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));
}

function refuse(res: ServerResponse, status: number, code: string, message: string, remedy: string): void {
  json(res, status, { error: { code, message, remedy } });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    // An oversized body is read to the end and dropped, so the refusal still reaches the page.
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) reject(new Error('too large'));
      else resolveBody(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function listenOn(server: Server, port: number): Promise<boolean> {
  return new Promise((resolveListen, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      server.off('listening', onListening);
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') resolveListen(false);
      else reject(err);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolveListen(true);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host: HOST, port, exclusive: true });
  });
}

/**
 * Asks whether a Tag Tool is already answering on a port. Used by the launcher so a
 * second double click opens the page that is running rather than fighting it for
 * the reader.
 */
export function probeExisting(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const req = httpRequest(
      { host: HOST, port, path: '/api/ping', method: 'GET', headers: { Host: `${HOST}:${port}` }, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { app?: unknown };
            resolveProbe(body.app === 'trevean-tag-tool');
          } catch {
            resolveProbe(false);
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolveProbe(false);
    });
    req.on('error', () => resolveProbe(false));
    req.end();
  });
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const { controller } = options;
  const bench = options.bench ?? null;
  const page = readFileSync(resolve(STATIC_DIR, 'page.html'), 'utf8');
  const script = readFileSync(resolve(STATIC_DIR, 'page.js'), 'utf8');
  const streams = new Set<ServerResponse>();
  let port = 0;

  const allowedHosts = (): Set<string> => new Set([`${HOST}:${port}`, `localhost:${port}`]);
  const allowedOrigins = (): Set<string> => new Set([`http://${HOST}:${port}`, `http://localhost:${port}`]);

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (!allowedHosts().has(host)) {
      send(res, 403, 'text/plain; charset=utf-8', 'This address is not the Tag Tool.');
      return;
    }
    const path = new URL(req.url ?? '/', `http://${HOST}:${port}`).pathname;
    const method = req.method ?? 'GET';

    if (method === 'GET' || method === 'HEAD') {
      switch (path) {
        case '/':
        case '/index.html':
          send(res, 200, 'text/html; charset=utf-8', page, { 'Content-Security-Policy': PAGE_CSP });
          return;
        case '/page.js':
          send(res, 200, 'text/javascript; charset=utf-8', script);
          return;
        case '/favicon.ico':
          res.writeHead(204, SECURITY_HEADERS);
          res.end();
          return;
        case '/api/ping':
          json(res, 200, { app: 'trevean-tag-tool', version: controller.snapshot().version });
          return;
        case '/api/state':
          json(res, 200, controller.snapshot());
          return;
        case '/api/codes':
          json(res, 200, { codes: controller.codes() });
          return;
        case '/api/events':
          openStream(res);
          return;
        default:
          refuse(res, 404, 'NOT_FOUND', `Nothing at ${path}.`, 'Open the Tag Tool page at /.');
          return;
      }
    }

    if (method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      refuse(res, 405, 'METHOD', `${method} is not used here.`, 'This is a bug in the page. Report it.');
      return;
    }

    if (!['/api/write', '/api/auto', '/api/sim'].includes(path)) {
      refuse(res, 404, 'NOT_FOUND', `Nothing at ${path}.`, 'Open the Tag Tool page at /.');
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins().has(origin.toLowerCase())) {
      refuse(res, 403, 'FORBIDDEN', 'That request came from another web page.', 'Use the Tag Tool page itself.');
      return;
    }
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      refuse(res, 403, 'FORBIDDEN', 'That request came from another web page.', 'Use the Tag Tool page itself.');
      return;
    }
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      refuse(res, 415, 'BAD_REQUEST', 'The Tag Tool only accepts JSON.', 'This is a bug in the page. Report it.');
      return;
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(await readBody(req));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      body = parsed as Record<string, unknown>;
    } catch {
      refuse(res, 400, 'BAD_REQUEST', 'The request could not be read.', 'This is a bug in the page. Report it.');
      return;
    }

    try {
      if (path === '/api/write') {
        // Only the code is read. Anything else in the body is ignored on purpose:
        // there is no option here a request can turn on.
        const code = typeof body.code === 'string' ? body.code : '';
        controller.requestWrite(code);
        json(res, 202, { accepted: true });
        return;
      }
      if (path === '/api/auto') {
        const enabled = body.enabled === true;
        const code = typeof body.code === 'string' ? body.code : null;
        controller.setAuto(enabled, code);
        json(res, 200, { auto: controller.snapshot().auto });
        return;
      }
      // /api/sim
      if (bench === null) {
        refuse(res, 404, 'NOT_FOUND', 'The simulator controls exist only when the Tag Tool runs with --simulator.', 'Use the real reader.');
        return;
      }
      switch (body.action) {
        case 'place':
          await bench.placeTag();
          break;
        case 'remove':
          await bench.removeTag();
          break;
        case 'unplug':
          await bench.unplugReader();
          break;
        case 'plug':
          await bench.plugReader();
          break;
        default:
          refuse(res, 400, 'BAD_REQUEST', 'Unknown simulator action.', 'Use place, remove, unplug or plug.');
          return;
      }
      controller.emit();
      json(res, 200, { ok: true });
    } catch (cause) {
      if (cause instanceof AppRefusal) {
        json(res, cause.status, { error: cause.error });
        return;
      }
      if (isChipError(cause)) {
        json(res, 400, { error: { code: cause.code, message: cause.message, remedy: cause.remedy } });
        return;
      }
      throw cause;
    }
  };

  const openStream = (res: ServerResponse): void => {
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    const push = (snapshot: unknown): void => {
      res.write(`event: state\ndata: ${JSON.stringify(snapshot)}\n\n`);
    };
    push(controller.snapshot());
    const unsubscribe = controller.subscribe(push);
    const heartbeat = setInterval(() => res.write(': still here\n\n'), HEARTBEAT_MS);
    streams.add(res);
    res.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(res);
    });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) refuse(res, 500, 'INTERNAL', 'The Tag Tool hit an unexpected problem.', 'Try again. If it repeats, close the Tag Tool and start it again.');
      else res.end();
    });
  });

  let bound = false;
  for (const candidate of options.ports) {
    if (await listenOn(server, candidate)) {
      bound = true;
      break;
    }
  }
  if (!bound && options.allowAnyPort === true) bound = await listenOn(server, 0);
  if (!bound) {
    throw new Error(`None of the ports ${options.ports.join(', ')} on ${HOST} is free.`);
  }

  const address = server.address() as AddressInfo;
  port = address.port;

  return {
    url: `http://${HOST}:${port}/`,
    port,
    address: address.address,
    server,
    close: () =>
      new Promise<void>((resolveClose) => {
        for (const res of streams) res.end();
        server.close(() => resolveClose());
        server.closeAllConnections();
      }),
  };
}
