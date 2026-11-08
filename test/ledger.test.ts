import assert from "node:assert/strict";
import { test } from "node:test";
import { eventsFrom, sumEvents } from "../src/ledger.js";

const events = [
  { timestamp: "1000", chargedCents: 1.5, tokenUsage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, totalCents: 3 } },
  { timestamp: "2000", chargedCents: 2.5, tokenUsage: { inputTokens: 20, outputTokens: 4, cacheReadTokens: 5, cacheWriteTokens: 1, totalCents: 4 } },
];

test("ledger events sum to cents and tokens", () => {
  const cost = sumEvents(events);
  assert.equal(cost.chargedCents, 4);
  assert.equal(cost.totalCents, 7);
  assert.equal(cost.inputTokens, 30);
  assert.equal(cost.events, 2);
});

test("no events means no number, not zero", () => {
  assert.equal(sumEvents([]).chargedCents, null);
});

test("a retry window keeps events from its start", () => {
  assert.equal(eventsFrom(events, new Date(1500).toISOString()).length, 1);
});
