/**
 * The whole local stack, in one function, with no AWS account and no Docker.
 *
 *   in process DynamoDB  ->  recording proxy  ->  the API from build/api  ->  this dashboard
 *
 * The recording proxy is not scaffolding for its own sake. It is how the test suite proves
 * that a dashboard load issues no table scan, by watching the operations rather than by
 * reading the source. It is on by default here too, so the claim is checkable by hand at
 * any time with a running stack.
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import { API_DIR, TSX_CLI, loadDynalite, requireApiDependenciesOrExplain } from './deps.mjs';
import { createRecordingProxy } from './recorder.mjs';
import { DEV_SECRET_DEFAULT, DEV_SECRET_ENV, mintDevToken } from './devtoken.mjs';
import { seedRollups } from '../seed-rollups.mjs';

export async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt made';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`The API did not become healthy at ${url}. Last attempt: ${lastError}`);
}

function runApiScript(scriptPath, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, scriptPath], {
      cwd: API_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptPath} exited with code ${code}. ${stderr}`));
    });
  });
}

export async function startStack(options = {}) {
  requireApiDependenciesOrExplain();

  const {
    today = new Date().toISOString().slice(0, 10),
    days = 90,
    hourlyDays = 3,
    qrRoute = 'distinct',
    recordDynamo = true,
    quiet = false,
    seed = true,
  } = options;

  const log = (line) => {
    if (!quiet) process.stdout.write(`${line}\n`);
  };

  const dbPort = await freePort();
  const dynalite = loadDynalite();
  const database = dynalite({ createTableMs: 0, updateTableMs: 0, deleteTableMs: 0 });
  await new Promise((resolve, reject) => database.listen(dbPort, (err) => (err ? reject(err) : resolve())));
  log(`Local DynamoDB on http://127.0.0.1:${dbPort}`);

  let proxy = null;
  let apiDatabaseEndpoint = `http://127.0.0.1:${dbPort}`;
  if (recordDynamo) {
    proxy = createRecordingProxy(dbPort);
    const proxyPort = await proxy.listen(await freePort());
    apiDatabaseEndpoint = `http://127.0.0.1:${proxyPort}`;
    log(`Recording proxy on http://127.0.0.1:${proxyPort}, every database operation is captured`);
  }

  const apiPort = await freePort();
  const secret = process.env[DEV_SECRET_ENV] ?? DEV_SECRET_DEFAULT;

  const setupEnv = {
    ...process.env,
    STAGE: 'local',
    // Table creation and content seeding go straight to the database. Only the API is
    // pointed at the recorder, so the operation log contains the dashboard's reads and
    // nothing else.
    DYNAMODB_ENDPOINT: `http://127.0.0.1:${dbPort}`,
    AWS_ACCESS_KEY_ID: 'local',
    AWS_SECRET_ACCESS_KEY: 'local',
    AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
    [DEV_SECRET_ENV]: secret,
  };

  await runApiScript('scripts/create-tables.ts', setupEnv);
  log('Five tables created');
  await runApiScript('scripts/seed.ts', setupEnv);
  log('Content seeded: five blends, growers, recipes, catalog mirror, tag records');

  let rollupCount = 0;
  if (seed) {
    rollupCount = await seedRollups({
      endpoint: `http://127.0.0.1:${dbPort}`,
      today,
      days,
      hourlyDays,
      qrRoute,
    });
    log(`Rollups seeded: ${rollupCount} items, ${days} days ending ${today}, QR route ${qrRoute}`);
  }

  const apiEnv = { ...setupEnv, DYNAMODB_ENDPOINT: apiDatabaseEndpoint, PORT: String(apiPort), HOST: '127.0.0.1' };
  const api = spawn(process.execPath, [TSX_CLI, 'src/index.ts'], {
    cwd: API_DIR,
    env: apiEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let apiOutput = '';
  api.stdout.on('data', (chunk) => {
    apiOutput += chunk.toString();
  });
  api.stderr.on('data', (chunk) => {
    apiOutput += chunk.toString();
  });

  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  try {
    await waitForHealth(`${apiBaseUrl}/health`);
  } catch (error) {
    api.kill();
    throw new Error(`${error.message}\nAPI output:\n${apiOutput}`);
  }
  log(`API on ${apiBaseUrl}`);

  return {
    apiBaseUrl,
    dbPort,
    proxy,
    rollupCount,
    today,
    viewerToken: mintDevToken({ roles: ['Viewer'], secret }),
    adminToken: mintDevToken({ roles: ['Admin', 'Editor', 'Viewer'], secret }),
    apiOutput: () => apiOutput,
    async stop() {
      api.kill();
      if (proxy) await proxy.close();
      await new Promise((resolve) => database.close(resolve));
    },
  };
}
