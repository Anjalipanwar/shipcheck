import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Reads the parts of action.yml and the workflow files that the tests need, without a YAML
 * library (none is a dependency): input names, `run:` scripts and `uses:` lines. The files are
 * formatted by prettier, so their shape is stable.
 */
const root = fileURLToPath(new URL('../../', import.meta.url));
export const readRepoFile = (path: string): string => readFileSync(`${root}${path}`, 'utf8');

/** Names under the top-level `inputs:` key of action.yml. */
export function actionInputs(yaml: string): string[] {
  const lines = yaml.split('\n');
  const start = lines.indexOf('inputs:');
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // next top-level key
    const name = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line)?.[1];
    if (name) names.push(name);
  }
  return names;
}

/** Every multi-line `run: |` script, with its indentation removed. */
export function runScripts(yaml: string): string[] {
  const lines = yaml.split('\n');
  const scripts: string[] = [];
  lines.forEach((line, index) => {
    const indent = /^(\s*)run: \|\s*$/.exec(line)?.[1];
    if (indent === undefined) return;
    const body: string[] = [];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() !== '' && !next.startsWith(`${indent}  `)) break;
      body.push(next.slice(indent.length + 2));
    }
    scripts.push(body.join('\n').trimEnd());
  });
  return scripts;
}

/** `key: value` pairs under the `with:` of the step that uses the given action. */
export function withOf(yaml: string, uses: string): Record<string, string> {
  const lines = yaml.split('\n');
  // A comment that mentions the action is not the step.
  const at = lines.findIndex(
    (line) => !line.trim().startsWith('#') && line.includes(`uses: ${uses}`),
  );
  const start = lines.findIndex((line, index) => index > at && /^\s*with:\s*$/.test(line));
  const result: Record<string, string> = {};
  if (at < 0 || start < 0) return result;
  const indent = /^(\s*)/.exec(lines[start] ?? '')?.[1] ?? '';
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (!line.startsWith(`${indent}  `)) break;
    const pair = /^\s*([a-z][a-z0-9-]*):\s*(.*)$/.exec(line);
    if (pair?.[1]) result[pair[1]] = pair[2] ?? '';
  }
  return result;
}
