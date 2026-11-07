import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ParsedVerdict } from "./verdict.js";
import type { PinnedModel, RepoRef, Setup } from "./types.js";

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
  setup: Setup;
  target: string;
  calls: number;
  minutes: number;
  chargedCents: number | null;
  rawCostCents: number | null;
  costSettled: boolean;
  verdict: ParsedVerdict;
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
