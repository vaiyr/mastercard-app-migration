import assert from "node:assert/strict";
import { test } from "node:test";
import { failureList, firstPrompt, retryPrompt } from "../src/prompts.js";
import type { Verdict } from "../src/types.js";

const r5Miss: Verdict = {
  r1: true, r2: true, r3: true, r4: true, r5: false, minimal: true, maximal: false,
  classMajors: [61], tests: 18, testsRequired: 18, testsBaseline: "given", trackedDependencies: 12,
  dependencyMisses: [{ dependency: "org.mockito:mockito-core", expected: "5.13.0", got: "4.5.1" }],
  diffApplied: true,
};

test("h1 prompt names the lookup tool, h2 names the pom bump", () => {
  assert.match(firstPrompt("h1", "17", 80, "migrate/x"), /lookup_dependency/);
  assert.match(firstPrompt("h2", "17", 80, "migrate/x"), /bump_poms\.py/);
  assert.match(firstPrompt("h2", "17", 80, "migrate/x"), /bootstrap-jdks\.sh/);
});

test("maven errors are appended once", () => {
  const prompt = firstPrompt("h2", "17", 80, "migrate/x", "[ERROR] Foo.java:[3,8] cannot find symbol");
  assert.match(prompt, /cannot find symbol/);
  assert.equal(prompt.split("Errors:").length, 2);
});

test("the retry lists only the failed checks", () => {
  const list = failureList(r5Miss);
  assert.match(list, /r5 FAIL/);
  assert.match(list, /mockito-core: have 4\.5\.1, need major 5\.13\.0/);
  assert.doesNotMatch(list, /r1 FAIL|r3 FAIL/);
  assert.match(retryPrompt(r5Miss, "migrate/x"), /Stay on branch migrate\/x/);
  assert.match(firstPrompt("h2", "17", 80, "migrate/x"), /git push origin migrate\/x/);
});
