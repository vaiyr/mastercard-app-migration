import assert from "node:assert/strict";
import { test } from "node:test";
import { SUMMARY_COLUMNS, summaryRow } from "../src/report.js";
import type { Report } from "../src/types.js";

test("a report becomes one csv row with every column", () => {
  const report: Report = {
    run: "r", repo: "a", upstreamUrl: "u", baseCommit: "b", forkUrl: "f", harnessCommit: "h",
    setup: "h2", model: { id: "composer-2.5" }, target: "17", retry: true, mavenErrors: false,
    agentId: "bc-1", agentUrl: "https://cursor.com/agents/bc-1", branch: "cursor/x",
    attempts: [
      { kind: "first", stopReason: "finished", startedAt: "s", endedAt: "e", minutes: 3, calls: 20, cost: { chargedCents: 3.4, totalCents: 5, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, events: 2 } },
      { kind: "retry", stopReason: "finished", startedAt: "s2", endedAt: "e2", minutes: 2, calls: 10, cost: { chargedCents: 6.4, totalCents: 8, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, events: 3 } },
    ],
    calls: 30, minutes: 5, startedAt: "s", endedAt: "e2",
    verdict: { r1: true, r2: true, r3: true, r4: true, r5: true, minimal: true, maximal: true, classMajors: [61], tests: 18, testsRequired: 18, testsBaseline: "given", trackedDependencies: 9, dependencyMisses: [], diffApplied: true },
    cost: { chargedCents: 9.8, totalCents: 13, inputTokens: 2, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, events: 5 },
  };
  const cells = summaryRow(report).split(",");
  assert.equal(cells.length, SUMMARY_COLUMNS.length);
  assert.equal(cells[SUMMARY_COLUMNS.indexOf("maximal")], "1");
  assert.equal(cells[SUMMARY_COLUMNS.indexOf("retry_charged_cents")], "6.4");
});
