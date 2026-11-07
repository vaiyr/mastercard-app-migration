import assert from "node:assert/strict";
import test from "node:test";
import { envProofGap, parseEvalLog } from "../src/verdict.js";

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

test("env proof accepts a grader result of false", () => {
  const ndjson = [
    "Apache Maven 3.9.6",
    "Java version: 1.8.0_432, vendor: Eclipse Adoptium",
    "Apache Maven 3.9.6",
    "Java version: 17.0.13, vendor: Eclipse Adoptium",
  ].join("\n");
  const log = "[single-docker] Migration success (count) `False`: `args`.";
  assert.equal(envProofGap(ndjson, log), null);
  assert.equal(parseEvalLog(log).maximal, false);
});

test("env proof rejects a missing grader line", () => {
  const ndjson = [
    "Apache Maven 3.9.6",
    "Java version: 1.8.0_432",
    "Apache Maven 3.9.6",
    "Java version: 17.0.13",
  ].join("\n");
  const gap = envProofGap(ndjson, "docker failed before the evaluator");
  assert.match(gap ?? "", /grader=false/);
  assert.match(gap ?? "", /java8=true/);
});
