import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every suite mutates process level state: the session store, the local user file and
    // the stub API. Running files sequentially in one process keeps that honest rather
    // than making the tests fight each other and then adding retries to hide it.
    fileParallelism: false,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['test/**/*.test.ts'],
    reporters: ['verbose'],
  },
});
