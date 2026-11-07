import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { parseCsv } from "./csv.js";
import type { RepoRef } from "./types.js";

const execFileAsync = promisify(execFile);

export function recordsToRepos(records: Record<string, string>[]): RepoRef[] {
  return records.map((record) => {
    const url = record.github_url || record.url;
    const baseCommit = record.base_commit || record.baseCommit;
    const slug = (record.repo || url || "").split("/").filter(Boolean).pop() || "repo";
    if (!url || !baseCommit) {
      throw new Error("Each repo row needs github_url and base_commit");
    }
    return {
      id: record.repo || slug,
      name: slug,
      url,
      baseCommit,
      split: record.split,
    };
  });
}

export async function loadRepos(csvPath: string, match?: string): Promise<RepoRef[]> {
  const text = await readFile(csvPath, "utf8");
  let repos = recordsToRepos(parseCsv(text));
  if (match) {
    const needle = match.toLowerCase();
    repos = repos.filter((repo) =>
      [repo.id, repo.name, repo.url, repo.split ?? ""].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }
  return repos;
}

export async function resolveHead(url: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["ls-remote", url, "HEAD"], {
    timeout: 60_000,
  });
  const sha = stdout.trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/i.test(sha ?? "")) {
    throw new Error(`Could not resolve HEAD for ${url}`);
  }
  return sha;
}

export async function probeRepo(): Promise<RepoRef> {
  const url = process.env.HARNESS_PROBE_URL || "https://github.com/0xShamil/java-xid";
  const baseCommit = process.env.HARNESS_PROBE_SHA || (await resolveHead(url));
  const name = url.split("/").filter(Boolean).pop()?.replace(/\.git$/, "") || "probe";
  return {
    id: "env-probe",
    name,
    url,
    baseCommit,
  };
}

function deniedFragments(): string[] {
  return (process.env.HARNESS_NAME_DENY || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function forkName(repo: RepoRef, setup: string): string {
  const raw = setup === "env" ? `${repo.name}-env-probe` : repo.name;
  let cleaned = raw.toLowerCase();
  for (const fragment of deniedFragments()) {
    cleaned = cleaned.split(fragment).join("");
  }
  cleaned = cleaned
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.slice(0, 80) || "migration-fork";
}
