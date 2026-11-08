import { appendFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Setup } from "./types.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HARNESS_DIR = path.join(ROOT, "harness");
export const VERSIONS_FILE = path.join(ROOT, "grader", "dependency_version.json");

/** Paths the grader never sees: what the harness adds to a fork, and build output an agent may commit. */
export const EXCLUDED_PATHS = [".cursor", "AGENTS.md", "tools", "target", "**/target"] as const;

function notBytecode(source: string): boolean {
  const base = path.basename(source);
  return base !== "__pycache__" && !base.endsWith(".pyc");
}

/** Copy harness/ into a checkout and stamp the setup and target. */
export async function injectHarness(checkout: string, setup: Setup, target: string): Promise<void> {
  const cursor = path.join(checkout, ".cursor");
  await rm(cursor, { recursive: true, force: true });
  await mkdir(cursor, { recursive: true });
  await cp(path.join(HARNESS_DIR, "cursor"), cursor, { recursive: true, filter: notBytecode });
  await cp(path.join(HARNESS_DIR, "tools"), path.join(checkout, "tools"), { recursive: true, filter: notBytecode });
  await cp(path.join(HARNESS_DIR, "AGENTS.md"), path.join(checkout, "AGENTS.md"));
  await cp(VERSIONS_FILE, path.join(checkout, "tools", "deps-lookup", "versions.json"));
  if (setup === "h2") await rm(path.join(cursor, "mcp.json"), { force: true });
  await writeFile(path.join(cursor, "harness-setup"), `${setup}\n`);
  await writeFile(path.join(cursor, "harness-target"), `${target}\n`);
  await ignoreBuildOutput(checkout);
}

/** Agents commit with `git add -A`; keep Maven's target/ out of that. */
async function ignoreBuildOutput(checkout: string): Promise<void> {
  const file = path.join(checkout, ".gitignore");
  const current = await readFile(file, "utf8").catch(() => "");
  if (/^\/?target\/?$/m.test(current)) return;
  await appendFile(file, `${current && !current.endsWith("\n") ? "\n" : ""}target/\n`);
}
