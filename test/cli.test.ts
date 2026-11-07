import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "../src/cli.js";

test("requires setup and rejects unknown flags", () => {
  assert.throws(() => parseArgs([]), /--setup is required/);
  assert.throws(() => parseArgs(["--setup", "h1", "--seed", "1"]), /Unknown flag: --seed/);
  assert.throws(() => parseArgs(["--setup", "h1", "--concurrency", "6"]), /5 or below/);
});

test("parses the supported flags", () => {
  const options = parseArgs([
    "--setup",
    "h2",
    "--model",
    "composer-2.5",
    "--budget=40",
    "--concurrency",
    "5",
    "--target",
    "21",
    "--retry",
  ]);
  assert.deepEqual(options, {
    setup: "h2",
    model: "composer-2.5",
    budget: 40,
    concurrency: 5,
    target: "21",
    retry: true,
  });
});
