import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const EXCLUDES = [
  ":(exclude).cursor",
  ":(exclude)AGENTS.md",
  ":(exclude)tools",
];

export async function sourceDiff(
  checkout: string,
  baseCommit: string,
  headRef: string,
): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--binary", `${baseCommit}..${headRef}`, "--", ".", ...EXCLUDES],
    { cwd: checkout, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout;
}

export async function fetchFork(checkout: string, forkUrl: string, token: string): Promise<void> {
  const remote = new URL(forkUrl);
  remote.username = "x-access-token";
  remote.password = token;
  try {
    await execFileAsync("git", ["fetch", remote.toString(), "+refs/heads/*:refs/remotes/fork/*"], {
      cwd: checkout,
      timeout: 10 * 60 * 1000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.split(token).join("[REDACTED]"));
  }
}
