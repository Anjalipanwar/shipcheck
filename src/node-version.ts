/**
 * The oldest Node.js ShipCheck runs on (kept in step with "engines" in package.json).
 * This file is loaded before anything else, so it must stay free of imports and modern syntax:
 * on an old Node it has to work long enough to explain the problem instead of crashing.
 */
export const MIN_NODE = { major: 22, minor: 12 } as const;

/** Returns a friendly how-to if this Node.js is too old, or null if it is fine. */
export function nodeVersionProblem(version: string): string | null {
  const match = /^v?(\d+)\.(\d+)/.exec(version);
  if (!match) return null; // Unknown format: let it run rather than block a working setup.
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor)) {
    return null;
  }
  const needed = `${MIN_NODE.major}.${MIN_NODE.minor}`;
  return [
    '',
    `ShipCheck needs Node ${needed} or newer — you have Node ${version.replace(/^v/, '')}.`,
    '',
    'Here’s how to update:',
    `  1. Download the "LTS" version from https://nodejs.org and install it.`,
    `     (Using nvm? Run:  nvm install 22 && nvm use 22)`,
    '  2. Close this terminal and open a new one.',
    `  3. Check with:  node --version   (it should say v${needed} or higher)`,
    '  4. Run ShipCheck again.',
    '',
  ].join('\n');
}
