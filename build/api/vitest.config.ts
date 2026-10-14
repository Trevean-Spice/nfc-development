import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/helpers/setup-env.ts'],
    globalSetup: ['test/helpers/global-setup.ts'],
    // Integration tests each start their own in process DynamoDB on their own port,
    // so files can run in parallel, but a single fork keeps port allocation simple
    // and keeps the observed run deterministic on Windows.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['default'],
  },
});
