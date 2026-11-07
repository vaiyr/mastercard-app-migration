import assert from "node:assert/strict";
import test from "node:test";
import { FORK_OWNER, forkCloneUrl, newRepoBody, orgRepoCreatePath, resolveForkOwner } from "../src/github.js";
import { reusableHarnessCommit } from "../src/fork.js";
import { includeCopiedPath } from "../src/inject.js";
import { isUsageLimit, stopRemainingRepos } from "../src/agent-run.js";

const BASE = "40ca6e2894292c79f2830c9a23531c182f7fe8e4";
const HARNESS = "7484c6da72b3de9762bf93b7c9db68c58feb6bcc";

test("new forks are created private", () => {
  assert.equal(newRepoBody("queue-ticket-api").private, true);
});

test("forks are created in the mastercard-app-migration organization", () => {
  const previous = process.env.HARNESS_FORK_OWNER;
  delete process.env.HARNESS_FORK_OWNER;
  try {
    assert.equal(FORK_OWNER, "mastercard-app-migration");
    assert.equal(orgRepoCreatePath(), "/orgs/mastercard-app-migration/repos");
    assert.equal(forkCloneUrl("app"), "https://github.com/mastercard-app-migration/app");
    assert.equal(resolveForkOwner(), "mastercard-app-migration");
    assert.equal(resolveForkOwner("  mastercard-app-migration  "), "mastercard-app-migration");
    assert.throws(() => resolveForkOwner("vaiyr"), /mastercard-app-migration/);
  } finally {
    if (previous === undefined) delete process.env.HARNESS_FORK_OWNER;
    else process.env.HARNESS_FORK_OWNER = previous;
  }
});

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

test("does not reuse a harness commit from a different setup", () => {
  assert.equal(
    reusableHarnessCommit({
      remote: { sha: HARNESS, parents: [BASE] },
      baseCommit: BASE,
      hasHarnessFile: true,
      sameSetup: false,
    }),
    null,
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

test("a usage limit drops repositories that have not started", () => {
  const queue = ["running-elsewhere", "waiting"];
  const state = { stop: false };
  queue.shift();
  stopRemainingRepos(queue, state);
  assert.equal(state.stop, true);
  assert.deepEqual(queue, []);
});
