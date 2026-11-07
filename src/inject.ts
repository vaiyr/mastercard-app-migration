import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Setup } from "./types.js";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HARNESS_TEMPLATE = path.join(SRC_ROOT, "harness");

async function copyTree(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
}

export async function loadVersionMap(): Promise<Record<string, string>> {
  const versionsPath = process.env.HARNESS_VERSIONS;
  const extrasPath = process.env.HARNESS_VERSION_EXTRAS;
  const merged: Record<string, string> = {};
  for (const file of [versionsPath, extrasPath]) {
    if (!file) continue;
    const data = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error(`Version file is not an object: ${file}`);
    }
    for (const [key, value] of Object.entries(data)) {
      merged[key] = String(value);
    }
  }
  return merged;
}

export async function injectHarness(
  checkout: string,
  setup: Setup,
  target: string,
): Promise<void> {
  const cursorFrom = path.join(HARNESS_TEMPLATE, "cursor");
  const cursorTo = path.join(checkout, ".cursor");
  await rm(cursorTo, { recursive: true, force: true });
  await copyTree(cursorFrom, cursorTo);
  await copyTree(
    path.join(HARNESS_TEMPLATE, "tools"),
    path.join(checkout, "tools"),
  );
  await copyTree(path.join(HARNESS_TEMPLATE, "AGENTS.md"), path.join(checkout, "AGENTS.md"));
  if (setup === "h2") {
    await rm(path.join(cursorTo, "mcp.json"), { force: true });
  }
  await writeFile(path.join(cursorTo, "harness-setup"), `${setup}\n`);
  await writeFile(path.join(cursorTo, "harness-target"), `${target}\n`);
  const versions = await loadVersionMap();
  const versionsFile = path.join(checkout, "tools", "deps-lookup", "versions.json");
  await writeFile(versionsFile, `${JSON.stringify(versions, null, 2)}\n`);
}
