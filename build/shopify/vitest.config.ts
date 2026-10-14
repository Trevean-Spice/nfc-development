import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Nothing in this suite opens a socket, starts a server, or calls Shopify.
    // Every test is either pure computation or a fixture read, which is what makes
    // the whole suite runnable with no store access and no credentials.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 15000,
    reporters: ['default'],
  },
});
