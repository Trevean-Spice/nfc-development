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
    (server as Server).listen(port, (err?: Error) => (err ? reject(err) : resolve()));
  });
}

export async function teardown(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
}
