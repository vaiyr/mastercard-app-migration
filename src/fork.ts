import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { scrub } from "./env.js";
import { authedRemote, ensurePrivateRepo } from "./github.js";
import { EXCLUDED_PATHS, injectHarness } from "./harness.js";
import type { RepoRef, Setup } from "./types.js";

const execFileAsync = promisify(execFile);

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "Migration Harness",
  GIT_AUTHOR_EMAIL: "harness@example.com",
  GIT_COMMITTER_NAME: "Migration Harness",
  GIT_COMMITTER_EMAIL: "harness@example.com",
};

export async function git(args: string[], cwd: string, token?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: 10 * 60_000,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...GIT_IDENTITY },
    });
    return stdout;
  } catch (error) {
    throw new Error(scrub(error instanceof Error ? error.message : String(error), token));
  }
}

export interface PreparedFork {
  forkUrl: string;
  checkout: string;
  harnessCommit: string;
  harnessBranch: string;
}

/**
 * Clone the upstream repo at its base commit, add the harness files, and push
 * that one commit to the private fork as branch `harness-<setup>`. Cloud agents
 * only accept a branch name as their starting ref, so the report records the
 * commit SHA for later checks.
 */
export async function prepareFork(input: {
  repo: RepoRef;
  setup: Setup;
  target: string;
  owner: string;
  token: string;
  workRoot: string;
}): Promise<PreparedFork> {
  const { repo, setup, token } = input;
  const forkUrl = await ensurePrivateRepo(token, input.owner, repo.name);
  const checkout = path.join(input.workRoot, repo.name);
  await rm(checkout, { recursive: true, force: true });
  await mkdir(input.workRoot, { recursive: true });
  await git(["clone", "--quiet", "--no-tags", repo.url, checkout], input.workRoot, token);
  await git(["checkout", "--quiet", "--detach", repo.baseCommit], checkout, token);
  const harnessBranch = `harness-${setup}`;
  await git(["checkout", "--quiet", "-B", harnessBranch], checkout, token);
  await injectHarness(checkout, setup, input.target);
  if (setup === "h2") {
    await execFileAsync("python3", ["tools/bump_poms.py"], { cwd: checkout, timeout: 60_000 });
  }
  await git(["add", "-A"], checkout, token);
  await git(["commit", "--quiet", "-m", `Add the migration harness (${setup}, Java ${input.target})`], checkout, token);
  const harnessCommit = (await git(["rev-parse", "HEAD"], checkout, token)).trim();
  await git(["push", "--quiet", "--force", authedRemote(forkUrl, token), `${harnessBranch}:${harnessBranch}`], checkout, token);
  return { forkUrl, checkout, harnessCommit, harnessBranch };
}

/** Fetch the agent's branch from the fork into the local checkout as fork/<branch>. */
export async function fetchBranch(checkout: string, forkUrl: string, branch: string, token: string): Promise<string> {
  await git(["fetch", "--quiet", authedRemote(forkUrl, token), `+refs/heads/${branch}:refs/remotes/fork/${branch}`], checkout, token);
  return `fork/${branch}`;
}

/** The migration as the grader sees it: everything from the base commit except harness files and build output. */
export async function sourceDiff(checkout: string, baseCommit: string, headRef: string): Promise<string> {
  const excludes = EXCLUDED_PATHS.map((entry) => `:(exclude)${entry}`);
  return git(["diff", "--binary", `${baseCommit}..${headRef}`, "--", ".", ...excludes], checkout);
}

/** The commit a branch points at on the fork, or undefined when the branch does not exist. */
export async function remoteBranchSha(forkUrl: string, branch: string, token: string): Promise<string | undefined> {
  const out = await git(["ls-remote", authedRemote(forkUrl, token), `refs/heads/${branch}`], process.cwd(), token);
  const sha = out.trim().split(/\s+/)[0];
  return /^[0-9a-f]{40}$/i.test(sha ?? "") ? sha : undefined;
}
