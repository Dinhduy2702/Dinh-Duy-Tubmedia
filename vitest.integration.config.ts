import { defineConfig } from 'vitest/config';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared'), '@main': resolve('src/main') } },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    maxWorkers: Math.min(8, Math.max(1, availableParallelism() - 1)),
    testTimeout: 30_000
  }
});
