#!/usr/bin/env node
/*
 * Entry point. It only checks the Node.js version, then loads the real command line
 * (main.ts). Loading main.ts first would crash on an old Node before any message could be shown.
 */
import { nodeVersionProblem } from './node-version.js';

const problem = nodeVersionProblem(process.versions.node);
if (problem) {
  console.error(problem);
  process.exitCode = 2; // SPEC §5.1: ShipCheck itself could not run.
} else {
  await import('./main.js');
}
