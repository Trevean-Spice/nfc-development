/**
 * One command, the whole thing, no AWS account and no Docker.
 *
 *   npm run local:up
 *   npm run local:up -- --qr-not-distinct    seed the world where the printed QR does not
 *                                           arrive on a route of its own
 *
 * Starts an in process DynamoDB, a recording proxy in front of it, the API from build/api,
 * seeds content and 90 days of pre-aggregated rollups, and serves this dashboard with the
 * API proxied at the same origin.
 */

import { startStack } from './lib/stack.mjs';
import { createDashboardServer } from './server.mjs';
import { freePort } from './lib/stack.mjs';

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const qrRoute = flag('qr-not-distinct') ? 'not-distinct' : 'distinct';
  const today = option('today', new Date().toISOString().slice(0, 10));
  const days = Number.parseInt(option('days', '90'), 10);

  const stack = await startStack({ today, days, qrRoute });

  const port = Number.parseInt(process.env.DASHBOARD_PORT ?? '0', 10) || (await freePort());
  const server = createDashboardServer({ apiBaseUrl: stack.apiBaseUrl, devToken: stack.viewerToken });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  const address = `http://127.0.0.1:${server.address().port}`;
  process.stdout.write(
    [
      '',
      `Dashboard   ${address}`,
      `API         ${stack.apiBaseUrl}`,
      `Rollups     ${stack.rollupCount} items, ${days} days ending ${today}`,
      `QR route    ${qrRoute === 'distinct' ? 'distinct, the split is real' : 'not distinct, QR scans land in direct'}`,
      '',
      'A Viewer token is served at /dev/token for this session only. Every database operation',
      'passes through the recording proxy, so the no scan claim is checkable rather than asserted.',
      'Press Ctrl+C to stop.',
      '',
    ].join('\n'),
  );

  const shutdown = async () => {
    process.stdout.write('\nStopping.\n');
    server.close();
    await stack.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
