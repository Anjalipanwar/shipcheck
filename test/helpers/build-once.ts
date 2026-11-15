import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Builds the package once before the real-browser tests start. Several test files run the
 * built command (dist/cli.js); if each built it for itself, at the same time, one would delete
 * the folder the other is using.
 */
export default function buildOnce(): void {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });
  if (build.status !== 0) {
    throw new Error(
      `npm run build failed:\n${build.stdout.toString()}\n${build.stderr.toString()}`,
    );
  }
}
