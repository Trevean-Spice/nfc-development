/*
 * Entry point. Reads configuration, chooses a side of the seam, and starts the server.
 */

import { config } from './config.mjs';
import { createPublisherServer } from './server.mjs';
import { createStores } from './stores.mjs';

async function secretFor(cfg) {
  if (cfg.revalidation.secret) return cfg.revalidation.secret;
  if (cfg.stage === 'local') {
    // The same development value build/api falls back to. It is not a secret outside a
    // laptop and it is refused on any other stage, below.
    return 'local-development-revalidation-secret';
  }
  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({ region: cfg.site.region });
  const out = await client.send(new GetSecretValueCommand({ SecretId: cfg.revalidation.secretName }));
  if (!out.SecretString) {
    throw new Error(`${cfg.revalidation.secretName} holds no value, so no dispatch signature can be checked.`);
  }
  return out.SecretString;
}

const secret = await secretFor(config);
const { store, cdn } = createStores(config);
const server = createPublisherServer({ config, store, cdn, secret });

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `publisher listening on http://${config.host}:${config.port}\n` +
      `  stage        ${config.stage}\n` +
      `  target       ${config.target}\n` +
      `  origin       ${store.name}\n` +
      `  cdn          ${cdn.name}\n` +
      `  render dir   ${config.renderDir}\n` +
      `  render mode  ${config.renderMode}\n` +
      `  read back    ${config.cdn.publicBaseUrl || 'not configured, so nothing will be confirmed live'}\n`,
  );
});
