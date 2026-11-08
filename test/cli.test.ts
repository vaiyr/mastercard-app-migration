import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "../src/cli.js";

test("setup and repos are required", () => {
  assert.throws(() => parseArgs(["--repos", "a.csv"]), /--setup is required/);
  assert.throws(() => parseArgs(["--setup", "h2"]), /--repos is required/);
  assert.throws(() => parseArgs(["--setup", "h2", "--repos", "a.csv", "--bogus"]), /Unknown flag/);
});

test("flags parse with defaults", () => {
  const options = parseArgs(["--setup", "h2", "--repos", "repos/practice.csv", "--retry", "--concurrency", "4", "--name", "x"]);
  assert.equal(options.setup, "h2");
  assert.equal(options.model, "composer-2.5");
  assert.equal(options.budget, 200);
  assert.equal(options.target, "17");
  assert.equal(options.concurrency, 4);
  assert.equal(options.retry, true);
  assert.equal(options.name, "x");
});

test("concurrency is capped", () => {
  assert.throws(() => parseArgs(["--setup", "h1", "--repos", "a.csv", "--concurrency", "9"]), /1 to 5/);
});
