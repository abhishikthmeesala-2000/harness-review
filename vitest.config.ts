import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = (name: string): string => path.join(here, 'packages', name, 'src', 'index.ts');

export default defineConfig({
  resolve: {
    alias: {
      '@engagement-harness/core': pkg('core'),
      '@engagement-harness/agents': pkg('agents'),
      '@engagement-harness/pipeline': pkg('pipeline'),
      '@engagement-harness/reports': pkg('reports'),
      '@engagement-harness/providers': pkg('providers'),
      '@engagement-harness/eval': pkg('eval'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
});
