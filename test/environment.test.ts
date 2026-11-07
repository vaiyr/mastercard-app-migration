import assert from "node:assert/strict";
import test from "node:test";
import { needsDockerfileBuild, repoSlug } from "../src/environment.js";

test("a universal image still needs the Dockerfile build", () => {
  assert.equal(needsDockerfileBuild({ type: "universal_image" }), true);
  assert.equal(needsDockerfileBuild(undefined), true);
  assert.equal(needsDockerfileBuild({ type: "build" }), false);
});

test("repo slugs drop the scheme", () => {
  assert.equal(repoSlug("https://github.com/vaiyr/queue-ticket-api.git"), "github.com/vaiyr/queue-ticket-api");
});
