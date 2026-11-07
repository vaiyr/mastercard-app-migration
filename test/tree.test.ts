import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const FORBIDDEN = [
  "spec.md",
  "checklist.md",
  "HANDOFF.md",
  "problem.md",
  "MANIFEST.txt",
  "cohort_dependencies.json",
];

async function filesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "out" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(full)));
    else found.push(full);
  }
  return found;
}

test("the checkout does not contain spec inputs", async () => {
  const files = await filesUnder(ROOT);
  const names = new Set(files.map((file) => path.basename(file)));
  for (const name of FORBIDDEN) assert.equal(names.has(name), false, name);
});

test("harness text does not use the retired working name", async () => {
  const files = await filesUnder(ROOT);
  for (const file of files) {
    if (file.endsWith(".lock")) continue;
    const text = await readFile(file, "utf8");
    const retired = ["lts", "lift"].join("-");
    assert.equal(text.toLowerCase().includes(retired), false, file);
  }
});
