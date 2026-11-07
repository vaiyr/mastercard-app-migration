import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../src/csv.js";
import { forkName, recordsToRepos } from "../src/repos.js";

test("parses quoted csv rows", () => {
  const rows = parseCsv(
    'repo,github_url,base_commit,split,stack\nowner/app,https://github.com/owner/app,abc,"spring,web",train\n',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].split, "spring,web");
  assert.equal(rows[0].stack, "train");
  assert.equal(recordsToRepos(rows)[0].baseCommit, "abc");
});

test("fork names drop denied fragments", () => {
  process.env.HARNESS_NAME_DENY = "ExampleCo";
  try {
    const name = forkName(
      {
        id: "ExampleCo/exampleco-sample",
        name: "exampleco-sample",
        url: "https://github.com/ExampleCo/exampleco-sample",
        baseCommit: "a".repeat(40),
      },
      "h1",
    );
    assert.equal(name.includes("exampleco"), false);
    assert.equal(name, "sample");
  } finally {
    delete process.env.HARNESS_NAME_DENY;
  }
});
