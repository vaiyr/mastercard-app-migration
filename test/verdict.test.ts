import assert from "node:assert/strict";
import test from "node:test";
import { parseEvalLog } from "../src/verdict.js";

test("reads a passing maximal log", () => {
  const log = [
    "Repo (Build success, #tests) = (True, 4): `/tmp/repo`.",
    "Final eval for `https://github.com/example/app` (/data/diff.patch): Success = True.",
    "[single-docker] Migration success (count) `True`: `args`.",
  ].join("\n");
  const verdict = parseEvalLog(log);
  assert.equal(verdict.maximal, true);
  assert.equal(verdict.buildSuccess, true);
  assert.equal(verdict.r1, true);
  assert.equal(verdict.r5, true);
  assert.equal(verdict.testCount, 4);
});

test("separates a dependency failure from a green build", () => {
  const minimal = [
    "Repo (Build success, #tests) = (True, 4): `/tmp/repo`.",
    "[single-docker] Migration success (count) `True`: `args`.",
  ].join("\n");
  const maximal = [
    '[{"dependency": "org.example:lib", "expected-version": "2.0.0"}]',
    "Repo (Build success, #tests) = (False, 4): `/tmp/repo`.",
    "[single-docker] Migration success (count) `False`: `args`.",
  ].join("\n");
  const verdict = parseEvalLog(maximal, minimal);
  assert.equal(verdict.minimal, true);
  assert.equal(verdict.maximal, false);
  assert.equal(verdict.buildSuccess, true);
  assert.equal(verdict.r5, false);
  assert.deepEqual(verdict.dependencyFailures, ["org.example:lib"]);
});
