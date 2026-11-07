import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  authedRemote,
  commitDescendsFrom,
  defaultBranchCommit,
  ensureRepo,
  repoHasFile,
  scrub,
  type RemoteCommit,
} from "./github.js";
import { injectHarness } from "./inject.js";
import type { RepoRef, Setup } from "./types.js";

const execFileAsync = promisify(execFile);

async function git(
  args: string[],
  cwd: string,
  token?: string,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: 10 * 60 * 1000,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Migration Harness",
        GIT_AUTHOR_EMAIL: "harness@example.com",
        GIT_COMMITTER_NAME: "Migration Harness",
        GIT_COMMITTER_EMAIL: "harness@example.com",
      },
    });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(scrub(message, token));
  }
}

/**
 * Keep a fork whose default branch is already one harness commit on the pinned
 * base. A second inject would be a different commit and a non-fast-forward push.
 */
export function reusableHarnessCommit(input: {
  remote: RemoteCommit | null;
  baseCommit: string;
  hasHarnessFile: boolean;
  descendsFromBase?: boolean;
}): string | null {
  if (!input.remote || !input.hasHarnessFile) return null;
  const onBase =
    input.remote.sha === input.baseCommit ||
    input.remote.parents.includes(input.baseCommit) ||
    input.descendsFromBase === true;
  return onBase ? input.remote.sha : null;
}

export async function prepareFork(input: {
  repo: RepoRef;
  forkName: string;
  owner: string;
  token: string;
  setup: Setup;
  target: string;
  workRoot: string;
}): Promise<{ forkUrl: string; checkout: string; harnessCommit: string }> {
  const forkUrl = await ensureRepo(input.token, input.owner, input.forkName);
  const checkout = path.join(input.workRoot, input.forkName);
  await rm(checkout, { recursive: true, force: true });
  await mkdir(input.workRoot, { recursive: true });
  const existing = await defaultBranchCommit(input.token, input.owner, input.forkName);
  const hasHarnessFile = existing
    ? await repoHasFile(
        input.token,
        input.owner,
        input.forkName,
        ".cursor/environment.json",
        existing.sha,
      )
    : false;
  const descendsFromBase =
    existing !== null &&
    hasHarnessFile &&
    !existing.parents.includes(input.repo.baseCommit) &&
    existing.sha !== input.repo.baseCommit
      ? await commitDescendsFrom(
          input.token,
          input.owner,
          input.forkName,
          input.repo.baseCommit,
          existing.sha,
        )
      : false;
  const reuse = reusableHarnessCommit({
    remote: existing,
    baseCommit: input.repo.baseCommit,
    hasHarnessFile,
    descendsFromBase,
  });
  if (reuse) {
    await git(["clone", "--no-tags", forkUrl, checkout], input.workRoot, input.token);
    await git(["checkout", "--detach", reuse], checkout, input.token);
    return { forkUrl, checkout, harnessCommit: reuse };
  }
  await git(
    ["clone", "--no-tags", input.repo.url, checkout],
    input.workRoot,
    input.token,
  );
  await git(["checkout", "--detach", input.repo.baseCommit], checkout, input.token);
  await git(["checkout", "-B", "main"], checkout, input.token);
  await injectHarness(checkout, input.setup, input.target);
  await git(["add", "-A"], checkout, input.token);
  await git(
    ["commit", "-m", "Add the migration harness environment"],
    checkout,
    input.token,
  );
  const harnessCommit = (await git(["rev-parse", "HEAD"], checkout, input.token)).trim();
  const remote = authedRemote(forkUrl, input.token);
  await git(["push", "--set-upstream", remote, "main"], checkout, input.token);
  return { forkUrl, checkout, harnessCommit };
}
