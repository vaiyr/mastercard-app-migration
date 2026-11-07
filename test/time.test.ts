import assert from "node:assert/strict";
import test from "node:test";
import { epochToIso, runWindow } from "../src/time.js";

test("stamps a run from createdAt and duration", () => {
  const window = runWindow(1_794_033_675_143, 311_014);
  assert.equal(window.startedAt, "2026-11-07T06:41:15.143Z");
  assert.equal(window.endedAt, "2026-11-07T06:46:26.157Z");
});

test("does not invent a missing end", () => {
  const window = runWindow(1_794_033_675_143, undefined);
  assert.equal(window.startedAt, epochToIso(1_794_033_675_143));
  assert.equal(window.endedAt, "absent");
});

test("uses the observed clock only when the API omits the field", () => {
  const window = runWindow(undefined, undefined, {
    start: "2026-11-07T06:00:00.000Z",
    end: "2026-11-07T06:05:00.000Z",
  });
  assert.equal(window.startedAt, "2026-11-07T06:00:00.000Z");
  assert.equal(window.endedAt, "2026-11-07T06:05:00.000Z");
});
