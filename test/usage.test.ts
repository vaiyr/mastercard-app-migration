import assert from "node:assert/strict";
import test from "node:test";
import { absentUsage, snapshotFromUsage } from "../src/usage.js";

test("copies token counts and leaves missing fields absent", () => {
  const raw = {
    usage: {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 7,
      cacheWriteTokens: 0,
      totalTokens: 21,
    },
    cost: { rawCostCents: 0, chargedCents: 0 },
    runs: [{ runId: "run-1", usage: { inputTokens: 10 } }],
  };
  const snapshot = snapshotFromUsage(raw);
  assert.equal(snapshot.getUsage, raw);
  assert.equal(snapshot.tokens.inputTokens, 10);
  assert.equal(snapshot.tokens.outputTokens, 4);
  assert.equal(snapshot.tokens.cacheReadTokens, 7);
  assert.equal(snapshot.tokens.cacheWriteTokens, 0);
  assert.equal(snapshot.tokens.cacheTokens, "absent");
  assert.equal(snapshot.tokens.totalTokens, 21);
  assert.equal(snapshot.tokens.reasoningTokens, "absent");
  assert.equal(snapshot.chargedCents, 0);
  assert.equal(snapshot.rawCostCents, 0);
  assert.equal(snapshot.costSettled, true);
});

test("does not invent tokens when getUsage has no usage object", () => {
  const snapshot = snapshotFromUsage({ runs: [] });
  assert.deepEqual(snapshot.tokens, absentUsage().tokens);
  assert.equal(snapshot.chargedCents, "absent");
  assert.equal(snapshot.rawCostCents, "absent");
  assert.equal(snapshot.costSettled, false);
  assert.deepEqual(snapshot.getUsage, { runs: [] });
});

test("a failed usage read is absent", () => {
  const snapshot = absentUsage("boom");
  assert.equal(snapshot.getUsage, "absent");
  assert.equal(snapshot.tokens.inputTokens, "absent");
  assert.equal(snapshot.tokens.totalTokens, "absent");
  assert.equal(snapshot.error, "boom");
});
