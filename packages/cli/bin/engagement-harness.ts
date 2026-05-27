#!/usr/bin/env node
import { run } from '../src/index.js';

run(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`engagement-harness: ${message}\n`);
  process.exit(1);
});
