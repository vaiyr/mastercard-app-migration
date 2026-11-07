import assert from "node:assert/strict";
import test from "node:test";
import { emptyTeamUsage, sumUsageEvents } from "../src/team-usage.js";

test("sums token and cent fields and leaves missing ones absent", () => {
  const summed = sumUsageEvents([
    {
      chargedCents: 1.5,
      tokenUsage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 7, cacheWriteTokens: 1, totalCents: 2.25 },
    },
    {
      chargedCents: 0,
      tokenUsage: { inputTokens: 3, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 2, totalCents: 0.5 },
    },
    { chargedCents: 4 },
  ]);
  assert.equal(summed.inputTokens, 13);
  assert.equal(summed.outputTokens, 5);
  assert.equal(summed.cacheReadTokens, 7);
  assert.equal(summed.cacheWriteTokens, 3);
  assert.equal(summed.chargedCents, 5.5);
  assert.equal(summed.totalCents, 2.75);
  assert.equal(summed.eventCount, 3);
});

test("an empty event list does not invent zeros", () => {
  assert.deepEqual(sumUsageEvents([]), emptyTeamUsage());
});
