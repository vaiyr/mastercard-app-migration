import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv, reposFromRecords } from "../src/repos.js";

test("csv rows become repo refs", () => {
  const rows = parseCsv('repo,github_url,base_commit\n"a",https://github.com/o/a,abc\nb,https://github.com/o/b,def\n');
  const repos = reposFromRecords(rows);
  assert.deepEqual(repos.map((repo) => repo.name), ["a", "b"]);
  assert.equal(repos[0].baseCommit, "abc");
  assert.equal(repos[0].tests, undefined);
  assert.equal(reposFromRecords([{ github_url: "u", base_commit: "c", tests: "28" }])[0].tests, 28);
});

test("a row without a base commit is rejected", () => {
  assert.throws(() => reposFromRecords([{ github_url: "https://github.com/o/a", base_commit: "" }]), /base_commit/);
});
