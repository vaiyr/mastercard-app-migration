import path from "node:path";
import type { Options, Setup } from "./types.js";

export const MAX_CONCURRENCY = 5;

export const USAGE = `Usage: npm run harness -- --setup h1|h2 (--repo <github url> [--base <sha>] | --repos <csv>) [flags]

  --setup h1|h2         h1: the agent migrates with a version lookup tool.
                        h2: tools/bump_poms.py raises pom versions first; the agent repairs the build.
  --repo <url>          One GitHub repository to migrate.
  --base <sha>          Commit to migrate from. Default: the repository's HEAD.
  --repos <csv>         A batch: rows of repo,github_url,base_commit. Every row runs.
  --only <text>         With --repos, run only rows whose name or url contains this text.
  --model <id>          Catalog id from Cursor.models.list(). Default composer-2.5.
  --retry               After grading, send the failed checks back to the same agent once.
  --pr                  When the migration passes, open a pull request on the fork with the grader's verdict.
  --concurrency <n>     Agents in flight at once, 1 to ${MAX_CONCURRENCY}. Default 1.
  --budget <n>          Tool calls per agent before the run is cancelled. Default 200.
  --target 17|21        Java release to land on. Default 17.
  --name <text>         Run name. Reports go to out/<name>/. Default <setup>-<model>-<timestamp>.
  --out <dir>           Output root. Default out.
`;

function value(argv: string[], i: number): string {
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("--")) throw new Error(`${argv[i]} needs a value\n\n${USAGE}`);
  return next;
}

function integer(flag: string, raw: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${flag} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

export function parseArgs(argv: string[]): Options {
  let setup: Setup | undefined;
  let repos: string | undefined;
  let repo: string | undefined;
  let base: string | undefined;
  const options = {
    model: "composer-2.5",
    only: undefined as string | undefined,
    retry: false,
    pr: false,
    concurrency: 1,
    budget: 200,
    target: "17" as "17" | "21",
    name: undefined as string | undefined,
    out: "out",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case "--":
        break;
      case "--setup": {
        const raw = value(argv, i++);
        if (raw !== "h1" && raw !== "h2") throw new Error("--setup must be h1 or h2");
        setup = raw;
        break;
      }
      case "--repos":
        repos = value(argv, i++);
        break;
      case "--repo":
        repo = value(argv, i++);
        break;
      case "--base":
        base = value(argv, i++);
        break;
      case "--only":
        options.only = value(argv, i++);
        break;
      case "--model":
        options.model = value(argv, i++);
        break;
      case "--retry":
        options.retry = true;
        break;
      case "--pr":
        options.pr = true;
        break;
      case "--concurrency":
        options.concurrency = integer(flag, value(argv, i++), 1, MAX_CONCURRENCY);
        break;
      case "--budget":
        options.budget = integer(flag, value(argv, i++), 1);
        break;
      case "--target": {
        const raw = value(argv, i++);
        if (raw !== "17" && raw !== "21") throw new Error("--target must be 17 or 21");
        options.target = raw;
        break;
      }
      case "--name":
        options.name = value(argv, i++);
        break;
      case "--out":
        options.out = value(argv, i++);
        break;
      default:
        throw new Error(`Unknown flag ${flag}\n\n${USAGE}`);
    }
  }
  if (!setup) throw new Error(`--setup is required\n\n${USAGE}`);
  if (!repos && !repo) throw new Error(`--repo or --repos is required\n\n${USAGE}`);
  if (base && !repo) throw new Error("--base goes with --repo");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const repoName = repo?.replace(/\/+$/, "").replace(/\.git$/, "").split("/").pop();
  return {
    ...options,
    setup,
    repos: repos ? path.resolve(repos) : undefined,
    repo,
    base,
    out: path.resolve(options.out),
    name: options.name ?? (repoName ? `${repoName}-${setup}` : `${setup}-${options.model}-${stamp}`),
  };
}
