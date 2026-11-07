import assert from "node:assert/strict";
import test from "node:test";
import { reusableHarnessCommit } from "../src/fork.js";
import { includeCopiedPath } from "../src/inject.js";
import { isUsageLimit } from "../src/agent-run.js";

const BASE = "40ca6e2894292c79f2830c9a23531c182f7fe8e4";
const HARNESS = "7484c6da72b3de9762bf93b7c9db68c58feb6bcc";

test("reuses one harness commit on the pinned base", () => {
  assert.equal(
    reusableHarnessCommit({
      remote: { sha: HARNESS, parents: [BASE] },
      baseCommit: BASE,
      hasHarnessFile: true,
    }),
    HARNESS,
  );
});

test("reuses a later harness commit that still descends from the base", () => {
  assert.equal(
    reusableHarnessCommit({
      remote: { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", parents: [HARNESS] },
      baseCommit: BASE,
      hasHarnessFile: true,
      descendsFromBase: true,
    }),
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
});

test("does not reuse an empty repo or a different base", () => {
  assert.equal(
    reusableHarnessCommit({ remote: null, baseCommit: BASE, hasHarnessFile: false }),
    null,
  );
  assert.equal(
    reusableHarnessCommit({
      remote: { sha: HARNESS, parents: [BASE] },
      baseCommit: BASE,
      hasHarnessFile: false,
    }),
    null,
  );
  assert.equal(
    reusableHarnessCommit({
      remote: { sha: HARNESS, parents: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] },
      baseCommit: BASE,
      hasHarnessFile: true,
    }),
    null,
  );
});

test("skips bytecode when copying the harness tree", () => {
  assert.equal(includeCopiedPath("/tmp/harness/tools/deps-prepass.py"), true);
  assert.equal(includeCopiedPath("/tmp/harness/tools/__pycache__"), false);
  assert.equal(includeCopiedPath("/tmp/harness/tools/__pycache__/deps-prepass.cpython-312.pyc"), false);
});

test("recognizes a prepaid balance error", () => {
  assert.equal(
    isUsageLimit(
      "[usage_limit_exceeded] Your prepaid balance is used up. Add funds or enable auto top-up in your billing settings to keep going.",
    ),
    true,
  );
  assert.equal(isUsageLimit("model not found"), false);
  assert.equal(isUsageLimit(undefined), false);
});
