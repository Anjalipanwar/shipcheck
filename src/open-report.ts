/**
 * Opens the finished report in the user's browser (SPEC §5.1: "auto-open the report locally,
 * not in CI"). Only when a person is sitting at a terminal; never in CI, never when the output
 * is piped. Failing to open is not an error: the path is printed anyway.
 */

export interface OpenSituation {
  env: Record<string, string | undefined>;
  /** The output goes to a terminal a person is looking at. */
  interactive: boolean;
}

export function shouldOpenReport({ env, interactive }: OpenSituation): boolean {
  if (!interactive) return false;
  if (env.CI && env.CI !== 'false' && env.CI !== '0') return false;
  if (env.GITHUB_ACTIONS) return false;
  return true;
}

export type Opener = (path: string) => Promise<unknown>;

const defaultOpener: Opener = async (path) => {
  const { default: open } = await import('open');
  return open(path);
};

/** True if the report was handed to the browser. Never throws. */
export async function openReport(
  path: string,
  situation: OpenSituation,
  opener: Opener = defaultOpener,
): Promise<boolean> {
  if (!shouldOpenReport(situation)) return false;
  try {
    await opener(path);
    return true;
  } catch {
    return false;
  }
}
