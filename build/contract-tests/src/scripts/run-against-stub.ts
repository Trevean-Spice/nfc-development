// Starts the stub, points the suite at it, runs the suite, stops the stub.
//
// This is what proves the suite is correct today, before the real API exists. The exit code
// is the test runner's, so CI needs nothing else.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStub, unimplementedOperations } from '../stub/server.js';
import { operationList } from '../spec.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const testEntry = path.resolve(here, '..', 'tests', 'index.js');

async function main(): Promise<void> {
  const missing = unimplementedOperations();
  if (missing.length > 0) {
    console.error(
      `The stub does not implement ${missing.length} operation(s) the OpenAPI document defines: ` +
        `${missing.join(', ')}`,
    );
    process.exit(1);
  }

  const stub = await startStub(0);
  console.log(`Stub listening on ${stub.url}, implementing ${operationList.length} operations.`);
  console.log('');

  const child = spawn(
    process.execPath,
    ['--test', '--test-reporter=spec', testEntry],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        CONTRACT_TEST_BASE_URL: stub.url,
        // The one signal that the target is this package's own stub. Fixtures that depend
        // on values only the stub recognises are gated on it, and on nothing else.
        CONTRACT_TEST_STUB: 'true',
        CONTRACT_TEST_TOKEN_ADMIN: process.env.CONTRACT_TEST_TOKEN_ADMIN ?? 'stub-admin-token',
        CONTRACT_TEST_TOKEN_EDITOR: process.env.CONTRACT_TEST_TOKEN_EDITOR ?? 'stub-editor-token',
        CONTRACT_TEST_TOKEN_VIEWER: process.env.CONTRACT_TEST_TOKEN_VIEWER ?? 'stub-viewer-token',
        CONTRACT_TEST_ALLOW_WRITES: process.env.CONTRACT_TEST_ALLOW_WRITES ?? 'true',
      },
    },
  );

  child.on('exit', (code, signal) => {
    stub
      .close()
      .catch(() => undefined)
      .finally(() => {
        if (signal) {
          console.error(`Test process terminated by signal ${signal}.`);
          process.exit(1);
        }
        process.exit(code ?? 1);
      });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
