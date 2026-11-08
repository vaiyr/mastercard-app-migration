import assert from "node:assert/strict";
import { test } from "node:test";
import { extractMavenErrors } from "../src/maven.js";

test("error lines survive, chatter does not", () => {
  const log = "[INFO] Scanning\n[ERROR] Foo.java:[1,1] bad\nTests run: 3, Failures: 1\n[INFO] done";
  assert.equal(extractMavenErrors(log), "[ERROR] Foo.java:[1,1] bad\nTests run: 3, Failures: 1");
});

test("a log with no error lines keeps its tail", () => {
  assert.equal(extractMavenErrors("BUILD SUCCESS"), "BUILD SUCCESS");
});
