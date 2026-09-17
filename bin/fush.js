#!/usr/bin/env node
import { run } from '../src/cli.js';

// Closing a pipe (for example, `fush --help | head`) is not a CLI failure.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

process.exitCode = await run(process.argv.slice(2));
