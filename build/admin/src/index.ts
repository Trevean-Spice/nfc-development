import { config } from './config.js';
import { buildApp } from './server.js';

/**
 * Local and container entry point.
 *
 * Runs against the API in `build/api` with no AWS account, no Docker and no identity
 * provider. Start the API with `npm run local:up` there, then `npm run dev` here.
 */

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: config.port, host: config.host });
  process.stdout.write(
    `Trevean Spice admin listening on http://${config.host}:${config.port}\n` +
      `API: ${config.apiBaseUrl}\n` +
      `Stage: ${config.stage}\n` +
      `Content package: ${config.contentDir}\n`,
  );
}

main().catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
});
