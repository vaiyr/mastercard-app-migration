import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentUrl, runAgent } from "./agent.js";
import { parseArgs } from "./cli.js";
import { loadDotEnv, need } from "./env.js";
import { fetchBranch, git, prepareFork, remoteBranchSha, sourceDiff } from "./fork.js";
import { gradeDiff, failedVerdict } from "./grade.js";
import { emptyCost, eventsFrom, settledEvents, sumEvents } from "./ledger.js";
import { captureMavenErrors } from "./maven.js";
import { pinModel } from "./model.js";
import { firstPrompt, retryPrompt } from "./prompts.js";
import { appendSummary, writeReport } from "./report.js";
import { loadRepos } from "./repos.js";
import type { Attempt, Options, PinnedModel, RepoRef, Report, Verdict } from "./types.js";

function log(repo: string, message: string): void {
  process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${repo}: ${message}\n`);
}

function verdictWord(verdict: Verdict): string {
  if (verdict.error) return `grader error: ${verdict.error}`;
  const checks = (["r1", "r2", "r3", "r4", "r5"] as const).map((key) => `${key}=${verdict[key] ? "ok" : "FAIL"}`).join(" ");
  return `${verdict.maximal ? "PASS" : "fail"} (${checks})`;
}

async function gradeAttempt(input: {
  repo: RepoRef;
  checkout: string;
  forkUrl: string;
  branch: string | undefined;
  target: string;
  dir: string;
  suffix: string;
}): Promise<Verdict> {
  const token = need("GITHUB_TOKEN");
  let head = input.branch ? await fetchBranch(input.checkout, input.forkUrl, input.branch, token) : "HEAD";
  const diff = await sourceDiff(input.checkout, input.repo.baseCommit, head);
  const diffPath = path.join(input.dir, `source${input.suffix}.diff`);
  await writeFile(diffPath, diff);
  if (!input.branch) return failedVerdict("agent pushed no branch");
  return gradeDiff({
    githubUrl: input.repo.url,
    baseCommit: input.repo.baseCommit,
    diffPath,
    target: input.target,
    logPath: path.join(input.dir, `grader${input.suffix}.log`),
    official: process.env.GRADE_OFFICIAL === "1",
  });
}

async function runOne(repo: RepoRef, options: Options, model: PinnedModel): Promise<Report> {
  const runDir = path.join(options.out, options.name);
  const dir = path.join(runDir, repo.name);
  await mkdir(dir, { recursive: true });

  log(repo.name, `preparing fork (${options.setup})`);
  const fork = await prepareFork({
    repo,
    setup: options.setup,
    target: options.target,
    owner: need("FORK_OWNER"),
    token: need("GITHUB_TOKEN"),
    workRoot: path.join(options.out, "work", options.name),
    runBranch: `migrate/${options.name}`,
  });

  let mavenErrors: string | undefined;
  if (options.mavenErrors) {
    log(repo.name, "running Maven locally on the bumped tree");
    const captured = await captureMavenErrors(fork.checkout);
    await writeFile(path.join(dir, "maven-errors.log"), captured.full);
    await writeFile(path.join(dir, "maven-errors.txt"), `${captured.errors}\n`);
    mavenErrors = captured.errors;
  }

  const ndjsonPath = path.join(dir, "run.ndjson");
  const branchName = `migrate/${options.name}`;
  const common = {
    branch: branchName,
    target: options.target,
    branchPushed: async () => Boolean(await remoteBranchSha(fork.forkUrl, branchName, need("GITHUB_TOKEN"))),
    forkUrl: fork.forkUrl,
    startingRef: fork.harnessBranch,
    setup: options.setup,
    model,
    name: `${options.setup}-${model.id}-${repo.name}`,
    metadata: { run: options.name, setup: options.setup, model: model.id, repo: repo.name },
    budget: options.budget,
    ndjsonPath,
  };

  log(repo.name, `starting ${model.id} agent`);
  const first = await runAgent({ ...common, prompt: firstPrompt(options.setup, options.target, options.budget, branchName, mavenErrors) }, "first");
  const attempts: Attempt[] = [first.attempt];
  let branch = first.attempt.branch;
  log(repo.name, `agent ${first.attempt.stopReason} in ${first.attempt.minutes} min, ${first.attempt.calls} calls, branch ${branch ?? "none"}${first.attempt.error ? `, error: ${first.attempt.error}` : ""}`);

  log(repo.name, "grading");
  let verdict = await gradeAttempt({ repo, checkout: fork.checkout, forkUrl: fork.forkUrl, branch, target: options.target, dir, suffix: "" });
  first.attempt.verdict = verdict;
  log(repo.name, verdictWord(verdict));

  if (options.retry && !verdict.maximal && !verdict.error && !first.attempt.error) {
    log(repo.name, "retry: sending the failed checks back to the same agent");
    const retry = await runAgent({ ...common, prompt: retryPrompt(verdict, branchName), resumeId: first.agent.agentId }, "retry");
    attempts.push(retry.attempt);
    branch = retry.attempt.branch ?? branch;
    log(repo.name, `retry done in ${retry.attempt.minutes} min, ${retry.attempt.calls} calls`);
    verdict = await gradeAttempt({ repo, checkout: fork.checkout, forkUrl: fork.forkUrl, branch, target: options.target, dir, suffix: "-retry" });
    retry.attempt.verdict = verdict;
    log(repo.name, `after retry: ${verdictWord(verdict)}`);
  }
  await first.agent.close();

  const startedAt = attempts[0].startedAt;
  const endedAt = attempts[attempts.length - 1].endedAt;
  let cost = emptyCost();
  try {
    log(repo.name, "waiting for the usage ledger");
    const events = await settledEvents(need("CURSOR_ADMIN_API_KEY"), first.agent.agentId, startedAt, endedAt);
    cost = sumEvents(events);
    const retryAttempt = attempts.find((attempt) => attempt.kind === "retry");
    if (retryAttempt) {
      const retryEvents = eventsFrom(events, retryAttempt.startedAt);
      retryAttempt.cost = sumEvents(retryEvents);
      attempts[0].cost = sumEvents(events.filter((event) => !retryEvents.includes(event)));
    } else {
      attempts[0].cost = cost;
    }
  } catch (error) {
    cost = emptyCost(error instanceof Error ? error.message : String(error));
  }

  const report: Report = {
    run: options.name,
    repo: repo.name,
    upstreamUrl: repo.url,
    baseCommit: repo.baseCommit,
    forkUrl: fork.forkUrl,
    harnessCommit: fork.harnessCommit,
    setup: options.setup,
    model,
    target: options.target,
    retry: options.retry,
    mavenErrors: options.mavenErrors,
    agentId: first.agent.agentId,
    agentUrl: agentUrl(first.agent.agentId),
    branch,
    attempts,
    calls: attempts.reduce((total, attempt) => total + attempt.calls, 0),
    minutes: Number(attempts.reduce((total, attempt) => total + attempt.minutes, 0).toFixed(2)),
    startedAt,
    endedAt,
    verdict,
    cost,
    error: attempts.map((attempt) => attempt.error).filter(Boolean).join("; ") || cost.error || undefined,
  };
  await writeReport(dir, report);
  await appendSummary(runDir, report);
  log(repo.name, `${verdict.maximal ? "PASS" : "fail"}, $${((cost.chargedCents ?? 0) / 100).toFixed(3)}, ${report.minutes} min, ${report.calls} calls`);
  return report;
}

async function loadRunReports(runDir: string): Promise<Report[]> {
  const reports: Report[] = [];
  for (const entry of await readdir(runDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const text = await readFile(path.join(runDir, entry.name, "report.json"), "utf8").catch(() => "");
    if (text) reports.push(JSON.parse(text) as Report);
  }
  if (reports.length === 0) throw new Error(`No report.json under ${runDir}`);
  return reports;
}

/**
 * The retry lever on an earlier run: the agents that passed are copied over
 * unchanged, the agents that missed are resumed once with the failed checks.
 */
async function retryOne(previous: Report, options: Options): Promise<Report> {
  const runDir = path.join(options.out, options.name);
  const dir = path.join(runDir, previous.repo);
  await mkdir(dir, { recursive: true });
  const repo: RepoRef = { name: previous.repo, url: previous.upstreamUrl, baseCommit: previous.baseCommit };
  if (previous.verdict.maximal || previous.error) {
    const copied: Report = { ...previous, run: options.name };
    await writeReport(dir, copied);
    await appendSummary(runDir, copied);
    log(repo.name, previous.verdict.maximal ? "passed before, kept as is" : `skipped, earlier error: ${previous.error}`);
    return copied;
  }

  const workRoot = path.join(options.out, "work", options.name);
  const checkout = path.join(workRoot, repo.name);
  await mkdir(workRoot, { recursive: true });
  await git(["clone", "--quiet", "--no-tags", repo.url, checkout], workRoot).catch(() => undefined);
  await git(["checkout", "--quiet", "--detach", repo.baseCommit], checkout);

  const branchName = previous.branch ?? `migrate/${previous.run}`;
  log(repo.name, "retry: sending the failed checks back to the same agent");
  const retry = await runAgent(
    {
      forkUrl: previous.forkUrl,
      startingRef: `harness-${previous.setup}`,
      setup: previous.setup,
      model: previous.model,
      name: `${previous.setup}-${previous.model.id}-${repo.name}`,
      metadata: { run: options.name, setup: previous.setup, model: previous.model.id, repo: repo.name },
      prompt: retryPrompt(previous.verdict, branchName),
      budget: options.budget,
      ndjsonPath: path.join(dir, "run.ndjson"),
      branch: branchName,
      target: previous.target,
      branchPushed: async () => Boolean(await remoteBranchSha(previous.forkUrl, branchName, need("GITHUB_TOKEN"))),
      resumeId: previous.agentId,
    },
    "retry",
  );
  log(repo.name, `retry ${retry.attempt.stopReason} in ${retry.attempt.minutes} min, ${retry.attempt.calls} calls`);
  const branch = retry.attempt.branch ?? previous.branch;
  const verdict = await gradeAttempt({ repo, checkout, forkUrl: previous.forkUrl, branch, target: previous.target, dir, suffix: "-retry" });
  retry.attempt.verdict = verdict;
  log(repo.name, `after retry: ${verdictWord(verdict)}`);
  await retry.agent.close();

  const attempts = [...previous.attempts, retry.attempt];
  let cost = emptyCost();
  try {
    log(repo.name, "waiting for the usage ledger");
    const events = await settledEvents(need("CURSOR_ADMIN_API_KEY"), previous.agentId, previous.startedAt, retry.attempt.endedAt);
    cost = sumEvents(events);
    const retryEvents = eventsFrom(events, retry.attempt.startedAt);
    retry.attempt.cost = sumEvents(retryEvents);
    attempts[0].cost = sumEvents(events.filter((event) => !retryEvents.includes(event)));
  } catch (error) {
    cost = emptyCost(error instanceof Error ? error.message : String(error));
  }
  const report: Report = {
    ...previous,
    run: options.name,
    retry: true,
    branch,
    attempts,
    calls: attempts.reduce((total, attempt) => total + attempt.calls, 0),
    minutes: Number(attempts.reduce((total, attempt) => total + attempt.minutes, 0).toFixed(2)),
    endedAt: retry.attempt.endedAt,
    verdict,
    cost,
    error: retry.attempt.error ?? cost.error,
  };
  await writeReport(dir, report);
  await appendSummary(runDir, report);
  log(repo.name, `${verdict.maximal ? "PASS" : "fail"}, $${((cost.chargedCents ?? 0) / 100).toFixed(3)} total on this agent`);
  return report;
}

async function main(): Promise<void> {
  loadDotEnv();
  const options = parseArgs(process.argv.slice(2));
  for (const name of ["CURSOR_API_KEY", "CURSOR_ADMIN_API_KEY", "GITHUB_TOKEN", "FORK_OWNER", "MIGRATIONBENCH_DIR", "MIGRATIONBENCH_PYTHON", "JAVA17_HOME", "MAVEN_HOME"]) need(name);
  const reports: Report[] = [];
  let work: Array<{ name: string; run: () => Promise<Report> }>;
  if (options.retryRun) {
    const previous = (await loadRunReports(options.retryRun)).filter((report) => !options.only || report.repo.includes(options.only));
    const misses = previous.filter((report) => !report.verdict.maximal && !report.error).length;
    process.stderr.write(`Run ${options.name}: retry of ${options.retryRun}, ${misses} of ${previous.length} agents get one more turn\n`);
    work = previous.map((report) => ({ name: report.repo, run: () => retryOne(report, options) }));
  } else {
    const model = await pinModel(options.model);
    const repos = await loadRepos(options.repos, options.only);
    process.stderr.write(`Run ${options.name}: ${options.setup}, ${model.id} ${JSON.stringify(model.params ?? [])}, ${repos.length} repo(s), retry=${options.retry}, maven-errors=${options.mavenErrors}\n`);
    work = repos.map((repo) => ({ name: repo.name, run: () => runOne(repo, options, model) }));
  }

  const queue = [...work];
  const workers = Array.from({ length: Math.min(options.concurrency, queue.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        reports.push(await job.run());
      } catch (error) {
        log(job.name, `failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    }
  });
  await Promise.all(workers);

  const passed = reports.filter((report) => report.verdict.maximal).length;
  const cents = reports.reduce((total, report) => total + (report.cost.chargedCents ?? 0), 0);
  process.stderr.write(`\n${options.name}: ${passed}/${reports.length} passed, $${(cents / 100).toFixed(2)} charged. Summary: ${path.join(options.out, options.name, "summary.csv")}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
