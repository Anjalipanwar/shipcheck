import { randomUUID } from 'node:crypto';
import { mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigError } from './config.js';

/**
 * Makes sure the report can be written to `dir` before the app is opened (audit A-06): creates
 * the folder, writes and deletes one test file, then removes any folder it created itself, so a
 * check that is cancelled later leaves nothing behind. Throws a ConfigError in plain words.
 */
export async function checkOutputFolder(dir: string, shownAs: string): Promise<void> {
  let created: string | undefined;
  try {
    created = await mkdir(dir, { recursive: true });
    const probe = join(dir, `.shipcheck-write-test-${randomUUID()}`);
    await writeFile(probe, '');
    await unlink(probe);
  } catch (error) {
    throw new ConfigError(
      [
        `The report folder “${shownAs}” cannot be written to (${reason(error)}).`,
        'Nothing was checked. Choose another folder with --out, for example: --out shipcheck-report',
      ].join('\n'),
    );
  } finally {
    if (created) await rm(created, { recursive: true, force: true }).catch(() => undefined);
  }
}

function reason(error: unknown): string {
  const code = (error as { code?: string } | undefined)?.code;
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return 'no permission';
    case 'EEXIST':
    case 'ENOTDIR':
      return 'a file with that name is in the way';
    case 'EROFS':
      return 'the disk is read-only';
    case 'ENOSPC':
      return 'the disk is full';
    default:
      return code ?? 'unknown reason';
  }
}
