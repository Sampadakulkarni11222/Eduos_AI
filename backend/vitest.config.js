import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    // Every file connects to the same in-memory MongoDB via a global setup, so
    // files must not run concurrently against each other's collections.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000, // first run downloads the mongodb-memory-server binary
  },
});
