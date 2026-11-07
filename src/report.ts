import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ParsedVerdict } from "./verdict.js";
import type { PinnedModel, RepoRef, Setup } from "./types.js";
import type { TeamUsage } from "./team-usage.js";
import type { TokenCount } from "./usage.js";

export interface MigrationReport {
  repo: string;
  upstreamUrl: string;
  baseCommit: string;
  forkUrl?: string;
  harnessCommit?: string;
  agentId?: string;
  agentUrl?: string;
  runId?: string;
  branch?: string;
  model: PinnedModel;
  /** UTC start of this run, ISO-8601. `absent` when neither the API nor the local clock recorded it. */
  startedAt: string;
  /** UTC end of this run, ISO-8601. `absent` when it was not recorded. */
  endedAt: string;
  /** UTC window of a verifier retry, separate from the first attempt. */
  retryStartedAt?: string;
  retryEndedAt?: string;
  setup: Setup;
  target: string;
  calls: number;
  minutes: number;
  chargedCents: TokenCount;
  rawCostCents: TokenCount;
  costSettled: boolean;
  /** Full `getUsage()` object. The string `absent` when the call returned nothing. */
  getUsage: unknown;
  /** Token fields from `getUsage().usage`. Each missing field is the string `absent`. */
  tokens: Record<string, TokenCount>;
  /** Sums from the team filtered-usage-events endpoint for this cloud agent. */
  teamUsage: TeamUsage;
  verdict: ParsedVerdict;
  /** First grader result when `--retry` ran a second attempt. */
  verdictBeforeRetry?: ParsedVerdict;
  dependencies: { before: string[]; after: string[] };
  ndjsonPath?: string;
  evalLogPath?: string;
  error?: string;
}

export async function writeReport(outDir: string, report: MigrationReport): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, "migration-report.json");
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}

export function reportRepo(repo: RepoRef): Pick<MigrationReport, "repo" | "upstreamUrl" | "baseCommit"> {
  return { repo: repo.id, upstreamUrl: repo.url, baseCommit: repo.baseCommit };
}
