/**
 * Re-read the usage ledger for every report under a run directory and rewrite
 * the cost fields and summary.csv. Use it when the ledger lagged behind a run.
 *
 *   npm run costs -- out/<run>
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadDotEnv, need } from "./env.js";
import { eventsFrom, fetchUsageEvents, sumEvents } from "./ledger.js";
import { rewriteSummary, writeReport } from "./report.js";
import type { Report } from "./types.js";

async function main(): Promise<void> {
  loadDotEnv();
  const runDir = process.argv[2];
  if (!runDir) throw new Error("Usage: npm run costs -- out/<run>");
  const adminKey = need("CURSOR_ADMIN_API_KEY");
  const reports: Report[] = [];
  for (const entry of await readdir(runDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(runDir, entry.name, "report.json");
    const text = await readFile(file, "utf8").catch(() => "");
    if (!text) continue;
    const report = JSON.parse(text) as Report;
    const events = await fetchUsageEvents(adminKey, report.agentId, report.startedAt, report.endedAt);
    report.cost = sumEvents(events);
    const retry = report.attempts.find((attempt) => attempt.kind === "retry");
    if (retry) {
      const retryEvents = eventsFrom(events, retry.startedAt);
      retry.cost = sumEvents(retryEvents);
      report.attempts[0].cost = sumEvents(events.filter((event) => !retryEvents.includes(event)));
    } else if (report.attempts[0]) {
      report.attempts[0].cost = report.cost;
    }
    if (report.error && /ledger|usage-events/.test(report.error)) delete report.error;
    await writeReport(path.join(runDir, entry.name), report);
    reports.push(report);
    process.stderr.write(`${report.repo}: ${events.length} events, ${report.cost.chargedCents ?? "?"} cents\n`);
  }
  reports.sort((a, b) => a.repo.localeCompare(b.repo));
  await rewriteSummary(runDir, reports);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
