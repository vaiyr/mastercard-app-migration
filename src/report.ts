import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Report } from "./types.js";

export const SUMMARY_COLUMNS = [
  "run", "repo", "setup", "model", "retry",
  "r1", "r2", "r3", "r4", "r5", "maximal", "r4_baseline",
  "stop_reason", "nudged", "calls", "minutes", "started_at", "ended_at",
  "charged_cents", "total_cents", "first_charged_cents", "retry_charged_cents",
  "dependency_misses", "agent_url", "branch", "error",
] as const;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One line per run, the table the deck is built from. */
export function summaryRow(report: Report): string {
  const first = report.attempts.find((attempt) => attempt.kind === "first");
  const retry = report.attempts.find((attempt) => attempt.kind === "retry");
  const verdict = report.verdict;
  const values: Record<(typeof SUMMARY_COLUMNS)[number], unknown> = {
    run: report.run,
    repo: report.repo,
    setup: report.setup,
    model: report.model.id,
    retry: report.retry,
    r1: verdict.r1, r2: verdict.r2, r3: verdict.r3, r4: verdict.r4, r5: verdict.r5,
    maximal: verdict.maximal,
    r4_baseline: verdict.testsRequired < 0 ? "skipped" : verdict.testsBaseline === "given" ? "manifest" : "measured",
    stop_reason: report.attempts.map((attempt) => attempt.stopReason).join("+"),
    nudged: report.attempts.some((attempt) => attempt.nudged),
    calls: report.calls,
    minutes: report.minutes,
    started_at: report.startedAt,
    ended_at: report.endedAt,
    charged_cents: report.cost.chargedCents,
    total_cents: report.cost.totalCents,
    first_charged_cents: first?.cost?.chargedCents,
    retry_charged_cents: retry?.cost?.chargedCents,
    dependency_misses: verdict.dependencyMisses.map((miss) => `${miss.dependency} ${miss.got ?? "?"}<${miss.expected ?? "?"}`).join("; "),
    agent_url: report.agentUrl,
    branch: report.branch,
    error: report.error,
  };
  return SUMMARY_COLUMNS.map((column) => cell(values[column])).join(",");
}

export async function writeReport(dir: string, report: Report): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

export async function appendSummary(runDir: string, report: Report): Promise<void> {
  const file = path.join(runDir, "summary.csv");
  const exists = await readFile(file, "utf8").catch(() => "");
  if (!exists) await writeFile(file, `${SUMMARY_COLUMNS.join(",")}\n`);
  await appendFile(file, `${summaryRow(report)}\n`);
}

/** Rebuild summary.csv from every report.json under a run directory. */
export async function rewriteSummary(runDir: string, reports: Report[]): Promise<void> {
  const lines = [SUMMARY_COLUMNS.join(","), ...reports.map(summaryRow)];
  await writeFile(path.join(runDir, "summary.csv"), `${lines.join("\n")}\n`);
}
