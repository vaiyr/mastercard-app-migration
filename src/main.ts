import { IntegrationNotConnectedError } from "@cursor/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isUsageLimit, pollChargedCents, runCloudAgent, stopRemainingRepos } from "./agent-run.js";
import { parseArgs } from "./cli.js";
import { fetchFork, sourceDiff } from "./diff.js";
import { ensureEvaluatorReady, runEval } from "./evaluate.js";
import { prepareFork } from "./fork.js";
import { githubToken } from "./github.js";
import { pinModel } from "./model.js";
import { forkName, loadRepos, probeRepo } from "./repos.js";
import { reportRepo, writeReport, type MigrationReport } from "./report.js";
import type { RepoRef } from "./types.js";
import type { UsageSnapshot } from "./usage.js";
import { envProofGap, parseEvalLog, type ParsedVerdict } from "./verdict.js";

function usageFields(
  usage: UsageSnapshot,
): Pick<MigrationReport, "chargedCents" | "rawCostCents" | "costSettled" | "getUsage" | "tokens"> {
  return {
    chargedCents: usage.chargedCents,
    rawCostCents: usage.rawCostCents,
    costSettled: usage.costSettled,
    getUsage: usage.getUsage,
    tokens: usage.tokens,
  };
}

function unfinishedVerdict(note: string): ParsedVerdict {
  return {
    maximal: null,
    minimal: null,
    buildSuccess: null,
    testCount: null,
    r1: null,
    r2: null,
    r3: null,
    r4: null,
    r5: null,
    r1r2Combined: false,
    dependencyFailures: [],
    notes: [note],
  };
}

function outRoot(): string {
  return process.env.HARNESS_OUT || path.resolve("out");
}

function workRoot(): string {
  return process.env.HARNESS_WORK || path.join(outRoot(), "work");
}

async function selectRepos(setup: "env" | "h1" | "h2"): Promise<RepoRef[]> {
  if (setup === "env") return [await probeRepo()];
  const csvPath = process.env.HARNESS_REPOS;
  if (!csvPath) throw new Error("Set HARNESS_REPOS to a CSV with github_url and base_commit");
  const repos = await loadRepos(csvPath, process.env.HARNESS_REPO_MATCH);
  if (repos.length === 0) throw new Error("No repos matched");
  if (repos.length > 1 && process.env.HARNESS_ALLOW_MANY !== "1") {
    throw new Error(
      `Refusing to start ${repos.length} repos. Set HARNESS_REPO_MATCH to one row, or HARNESS_ALLOW_MANY=1.`,
    );
  }
  return repos;
}

async function pomVersions(checkout: string, ref: string): Promise<string[]> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  try {
    const { stdout } = await exec("git", ["grep", "-n", "<version>", ref, "--", "pom.xml", "*/pom.xml"], {
      cwd: checkout,
      timeout: 30_000,
    });
    return stdout.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 200);
  } catch {
    return [];
  }
}

async function runOne(
  repo: RepoRef,
  options: ReturnType<typeof parseArgs>,
  model: Awaited<ReturnType<typeof pinModel>>,
  halt: () => void,
): Promise<MigrationReport> {
  const owner = process.env.HARNESS_FORK_OWNER;
  if (!owner) throw new Error("Set HARNESS_FORK_OWNER to the neutral GitHub account that will hold forks");
  const denied = (process.env.HARNESS_NAME_DENY || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (denied.some((fragment) => owner.toLowerCase().includes(fragment))) {
    throw new Error("HARNESS_FORK_OWNER matches HARNESS_NAME_DENY");
  }
  const token = await githubToken();
  const name = forkName(repo, options.setup);
  const slug = name;
  const dir = path.join(outRoot(), slug);
  await mkdir(dir, { recursive: true });
  const prepared = await prepareFork({
    repo,
    forkName: name,
    owner,
    token,
    setup: options.setup,
    target: options.target,
    workRoot: workRoot(),
  });
  const ndjsonPath = path.join(dir, "run.ndjson");
  const started = await runCloudAgent({
    forkUrl: prepared.forkUrl,
    setup: options.setup,
    target: options.target,
    budget: options.budget,
    model,
    repoLabel: slug,
    ndjsonPath,
    startingRef: prepared.harnessCommit,
  });
  let capture = started.capture;
  if (isUsageLimit(capture.error)) {
    halt();
    const limitedUsage = await pollChargedCents(started.agent, { waitForCost: false });
    await started.agent.close();
    const report: MigrationReport = {
      ...reportRepo(repo),
      forkUrl: prepared.forkUrl,
      harnessCommit: prepared.harnessCommit,
      agentId: capture.agentId,
      agentUrl: capture.agentUrl,
      runId: capture.runId,
      branch: capture.branch,
      model,
      setup: options.setup,
      target: options.target,
      calls: capture.calls,
      minutes: Number(capture.minutes.toFixed(3)),
      ...usageFields(limitedUsage),
      verdict: unfinishedVerdict("Stopped before grading because usage_limit_exceeded."),
      dependencies: { before: [], after: [] },
      ndjsonPath,
      error: capture.error,
    };
    await writeReport(dir, report);
    return report;
  }
  let usage = await pollChargedCents(started.agent);

  let head = prepared.harnessCommit;
  if (capture.branch) {
    await fetchFork(prepared.checkout, prepared.forkUrl, token);
    head = `fork/${capture.branch}`;
  }
  let diffText =
    options.setup === "env"
      ? ""
      : await sourceDiff(prepared.checkout, repo.baseCommit, head).catch(() => "");
  const diffPath = path.join(dir, "source.diff");
  await writeFile(diffPath, diffText);

  const notes = await ensureEvaluatorReady();
  const maximal = await runEval({
    githubUrl: repo.url,
    baseCommit: repo.baseCommit,
    diffPath,
    target: options.target,
    maximal: true,
  });
  const minimal =
    options.setup === "env"
      ? undefined
      : await runEval({
          githubUrl: repo.url,
          baseCommit: repo.baseCommit,
          diffPath,
          target: options.target,
          maximal: false,
        });
  let verdict = parseEvalLog(maximal.log, minimal?.log);
  verdict = { ...verdict, notes: [...notes, ...verdict.notes] };
  let verdictBeforeRetry: ParsedVerdict | undefined;
  const evalLogPath = path.join(dir, "eval.log");
  await writeFile(evalLogPath, [maximal.log, minimal?.log ?? ""].join("\n----- minimal -----\n"));

  if (options.retry && options.setup !== "env" && verdict.maximal === false && !capture.error) {
    verdictBeforeRetry = verdict;
    const failureList = [
      `r1=${String(verdict.r1)}`,
      `r2=${String(verdict.r2)}`,
      `r3=${String(verdict.r3)}`,
      `r4=${String(verdict.r4)}`,
      `r5=${String(verdict.r5)}`,
      `maximal=${String(verdict.maximal)}`,
      `minimal=${String(verdict.minimal)}`,
      `buildSuccess=${String(verdict.buildSuccess)}`,
      ...verdict.dependencyFailures.map((dep) => `dependency ${dep}`),
      ...verdict.notes,
    ].join("\n");
    const retried = await runCloudAgent({
      forkUrl: prepared.forkUrl,
      setup: options.setup,
      target: options.target,
      budget: options.budget,
      model,
      repoLabel: slug,
      ndjsonPath,
      retryFailure: failureList,
      resumeId: started.agent.agentId,
    });
    capture = {
      ...retried.capture,
      calls: capture.calls + retried.capture.calls,
      minutes: capture.minutes + retried.capture.minutes,
    };
    if (isUsageLimit(retried.capture.error)) {
      halt();
      usage = await pollChargedCents(started.agent, { waitForCost: false });
    } else if (capture.branch) {
      await fetchFork(prepared.checkout, prepared.forkUrl, token);
      head = `fork/${capture.branch}`;
      diffText = await sourceDiff(prepared.checkout, repo.baseCommit, head).catch(() => "");
      await writeFile(diffPath, diffText);
      const retriedMaximal = await runEval({
        githubUrl: repo.url,
        baseCommit: repo.baseCommit,
        diffPath,
        target: options.target,
        maximal: true,
      });
      const retriedMinimal = await runEval({
        githubUrl: repo.url,
        baseCommit: repo.baseCommit,
        diffPath,
        target: options.target,
        maximal: false,
      });
      verdict = parseEvalLog(retriedMaximal.log, retriedMinimal.log);
      verdict = { ...verdict, notes: [...notes, ...verdict.notes] };
      await writeFile(
        evalLogPath,
        [retriedMaximal.log, retriedMinimal.log].join("\n----- minimal -----\n"),
      );
      usage = await pollChargedCents(started.agent);
    } else {
      usage = await pollChargedCents(started.agent);
    }
  }

  await started.agent.close();
  const before = await pomVersions(prepared.checkout, repo.baseCommit);
  const after = await pomVersions(prepared.checkout, head);
  const report: MigrationReport = {
    ...reportRepo(repo),
    forkUrl: prepared.forkUrl,
    harnessCommit: prepared.harnessCommit,
    agentId: capture.agentId,
    agentUrl: capture.agentUrl,
    runId: capture.runId,
    branch: capture.branch,
    model,
    setup: options.setup,
    target: options.target,
    calls: capture.calls,
    minutes: Number(capture.minutes.toFixed(3)),
    ...usageFields(usage),
    verdict,
    ...(verdictBeforeRetry ? { verdictBeforeRetry } : {}),
    dependencies: { before, after },
    ndjsonPath,
    evalLogPath,
    error: capture.error ?? usage.error,
  };
  await writeReport(dir, report);
  if (options.setup === "env") {
    const ndjson = await readFile(ndjsonPath, "utf8").catch(() => "");
    const gap = envProofGap(ndjson, maximal.log);
    if (gap) {
      report.error = [report.error, gap].filter(Boolean).join("; ");
      await writeReport(dir, report);
    }
  }
  return report;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const model = await pinModel(options.model);
  process.stderr.write(`Pinned model ${model.id}\n`);
  const repos = await selectRepos(options.setup);
  const reports: MigrationReport[] = [];
  const queue = [...repos];
  const gate = { stop: false };
  const halt = () => stopRemainingRepos(queue, gate);
  const workers = Array.from({ length: Math.min(options.concurrency, queue.length) }, async () => {
    for (;;) {
      if (gate.stop) return;
      const repo = queue.shift();
      if (!repo) return;
      const report = await runOne(repo, options, model, halt);
      reports.push(report);
      if (isUsageLimit(report.error)) return;
    }
  });
  await Promise.all(workers);
  process.stdout.write(`${JSON.stringify({ model, reports: reports.map((report) => ({
    repo: report.repo,
    agentUrl: report.agentUrl,
    chargedCents: report.chargedCents,
    minutes: report.minutes,
    maximal: report.verdict.maximal,
    error: report.error,
  })) }, null, 2)}\n`);
  if (reports.some((report) => report.error)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  if (error instanceof IntegrationNotConnectedError) {
    process.stderr.write(`${error.provider} ${error.helpUrl}\n`);
  }
  process.exitCode = 1;
});
