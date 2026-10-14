import dynalite from 'dynalite';
import type { Server } from 'node:http';

/**
 * Starts an in process DynamoDB compatible server for the whole run.
 *
 * It implements the real wire protocol, so conditional writes fail with a real
 * ConditionalCheckFailedException and ADD is a real atomic increment. That matters: the
 * two behaviours this API depends on most are exactly those two, and a hand written fake
 * would have proved nothing about either.
 */

let server: Server | undefined;

export async function setup(): Promise<void> {
  const port = Number.parseInt(process.env.TEST_DDB_PORT ?? '4571', 10);
  server = dynalite({ createTableMs: 0, updateTableMs: 0, deleteTableMs: 0 });
  await new Promise<void>((resolve, reject) => {
    // Loopback only: setup-env.ts points the client at 127.0.0.1, and nothing else
    // on the host has any business reaching a test database.
    (server as Server).listen(port, '127.0.0.1', (err?: Error) => (err ? reject(err) : resolve()));
  });
}

export async function teardown(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
}
