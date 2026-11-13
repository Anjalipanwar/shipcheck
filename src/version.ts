import { readFileSync } from 'node:fs';

/**
 * Version and repo URL, read from package.json at runtime.
 * Works both from source (src/) and from the bundle (dist/), which sit one level below the root.
 */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export const VERSION: string = pkg.version;
export const REPO_URL = 'https://github.com/Anjalipanwar/shipcheck';
