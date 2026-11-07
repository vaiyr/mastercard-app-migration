import assert from "node:assert/strict";
import test from "node:test";
import { extractMavenErrors } from "../src/maven-errors.js";

test("keeps compiler and test error lines", () => {
  const log = [
    "[INFO] Scanning for projects...",
    "[ERROR] COMPILATION ERROR",
    "[ERROR] /src/App.java:[10,8] cannot find symbol",
    "[INFO] BUILD FAILURE",
    "Tests run: 2, Failures: 1, Errors: 0, Skipped: 0",
  ].join("\n");
  const errors = extractMavenErrors(log);
  assert.match(errors, /cannot find symbol/);
  assert.match(errors, /Tests run: 2/);
  assert.doesNotMatch(errors, /Scanning for projects/);
});
