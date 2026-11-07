import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { needsDockerfileBuild, repoSlug } from "../src/environment.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const CURSOR_BUILD_FILES = [
  "Dockerfile",
  "environment.json",
  "install.sh",
  "settings.xml",
  "bootstrap-jdks.sh",
] as const;

test("a universal image still needs the Dockerfile build", () => {
  assert.equal(needsDockerfileBuild({ type: "universal_image" }), true);
  assert.equal(needsDockerfileBuild(undefined), true);
  assert.equal(needsDockerfileBuild({ type: "build" }), false);
});

test("repo slugs drop the scheme", () => {
  assert.equal(repoSlug("https://github.com/vaiyr/queue-ticket-api.git"), "github.com/vaiyr/queue-ticket-api");
});

test("root .cursor build files match harness/cursor", async () => {
  for (const name of CURSOR_BUILD_FILES) {
    const harness = await readFile(path.join(ROOT, "harness", "cursor", name));
    const root = await readFile(path.join(ROOT, ".cursor", name));
    assert.deepEqual(root, harness, name);
  }
});
