import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { promptFor } from "../src/prompts.js";

test("env prompt installs the pinned JDKs when the image is missing", () => {
  const prompt = promptFor("env", "17", 80);
  const script = readFileSync(
    new URL("../harness/cursor/bootstrap-jdks.sh", import.meta.url),
    "utf8",
  );
  assert.match(prompt, /1\.8\.0_432/);
  assert.match(prompt, /17\.0\.13/);
  assert.match(prompt, /3\.9\.6/);
  assert.match(prompt, /JAVA_HOME=\/opt\/java\/temurin-8 mvn -v/);
  assert.match(prompt, /JAVA_HOME=\/opt\/java\/temurin-17 mvn -v/);
  assert.match(prompt, /Do not commit/);
  assert.ok(prompt.includes(script.trimEnd()));
});

test("migration prompt runs the bootstrap script before verify", () => {
  const prompt = promptFor("h1", "17", 80);
  assert.match(prompt, /bash \.cursor\/bootstrap-jdks\.sh/);
  assert.match(prompt, /1\.8\.0_432/);
  assert.match(prompt, /temurin-17/);
});

test("h2 prompt starts from the pre-pass rewrite", () => {
  const prompt = promptFor("h2", "17", 80);
  assert.match(prompt, /deps-prepass\.py already rewrote pom\.xml/);
  assert.doesNotMatch(prompt, /deps-lookup tool/);
  assert.doesNotMatch(prompt, /Maven was run once/);
});

test("h2 prompt includes one up-front Maven error list", () => {
  const prompt = promptFor("h2", "17", 80, "[ERROR] cannot find symbol");
  assert.match(prompt, /\[ERROR\] cannot find symbol/);
  assert.match(prompt, /Fix the compiler and test errors/);
});
