import { buildApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './observability/logger.js';
import { redirectTable } from './services/redirectTable.js';

/**
 * Local and container entry point. The Lambda entry point is lambda.ts.
 */

async function main(): Promise<void> {
  // The redirect table is validated at startup, not only in CI. A deployment carrying a
  // broken table must fail loudly here rather than come up green and strand inventory.
  const table = redirectTable();
  logger.info('redirect table loaded', {
    entries: table.entries.length,
    encodedUnits: table.entries.filter((e) => e.status === 'encoded').reduce((n, e) => n + e.unitsEncoded, 0),
  });

  const app = await buildApp();
  await app.listen({ port: config.port, host: config.host });
  logger.info('api listening', { port: config.port, stage: config.stage });
}

main().catch((err) => {
  logger.error('failed to start', { message: (err as Error).message });
  process.exitCode = 1;
});
