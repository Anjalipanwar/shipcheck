import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MIN_NODE, nodeVersionProblem } from '../../src/node-version.js';

describe('nodeVersionProblem', () => {
  it('accepts 22.12 and anything newer', () => {
    for (const version of ['22.12.0', 'v22.12.0', '22.13.1', '23.0.0', '24.22.1', '30.1.0']) {
      expect(nodeVersionProblem(version)).toBeNull();
    }
  });

  it('refuses older versions with a friendly how-to', () => {
    for (const version of ['22.11.0', '20.17.0', '18.20.4', 'v16.0.0']) {
      const message = nodeVersionProblem(version);
      expect(message).toContain('ShipCheck needs Node 22.12 or newer');
      expect(message).toContain(`you have Node ${version.replace(/^v/, '')}`);
      expect(message).toContain('https://nodejs.org');
      expect(message).toContain('node --version');
    }
  });

  it('does not block an unknown version format', () => {
    expect(nodeVersionProblem('nightly')).toBeNull();
  });

  it('matches "engines" in package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { engines: { node: string } };
    expect(pkg.engines.node).toBe(`>=${MIN_NODE.major}.${MIN_NODE.minor}.0`);
  });
});
