import assert from "node:assert/strict";
import { test } from "node:test";
import { classMajor, parseGraderOutput } from "../src/grade.js";

test("the grader's last line is the verdict", () => {
  const verdict = parseGraderOutput('noise\n{"r1":true,"r2":true,"r3":true,"r4":true,"r5":false,"minimal":true,"maximal":false,"classMajors":[61],"tests":18,"testsRequired":18,"testsBaseline":"given","trackedDependencies":3,"dependencyMisses":[],"diffApplied":true}\n');
  assert.equal(verdict.maximal, false);
  assert.equal(verdict.r5, false);
});

test("a grader that printed nothing is a failed verdict with an error", () => {
  const verdict = parseGraderOutput("");
  assert.equal(verdict.maximal, false);
  assert.match(verdict.error ?? "", /nothing/);
});

test("class majors follow the Java release", () => {
  assert.equal(classMajor("17"), 61);
  assert.equal(classMajor("21"), 65);
});
