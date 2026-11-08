import { readFile } from "node:fs/promises";
import type { RepoRef } from "./types.js";

/** Small RFC 4180 reader. Enough for the repo manifests in repos/. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  const [header = [], ...body] = rows;
  return body.map((cells) =>
    Object.fromEntries(header.map((name, index) => [name.trim(), (cells[index] ?? "").trim()])),
  );
}

export function reposFromRecords(records: Record<string, string>[]): RepoRef[] {
  return records.map((record) => {
    const url = record.github_url;
    const baseCommit = record.base_commit;
    if (!url || !baseCommit) throw new Error("Each row needs github_url and base_commit");
    const name = (record.repo || url).split("/").filter(Boolean).pop() ?? "repo";
    const tests = /^\d+$/.test(record.tests ?? "") ? Number(record.tests) : undefined;
    return { name, url, baseCommit, ...(tests !== undefined ? { tests } : {}) };
  });
}

export async function loadRepos(csvPath: string, only?: string): Promise<RepoRef[]> {
  const repos = reposFromRecords(parseCsv(await readFile(csvPath, "utf8")));
  const needle = only?.toLowerCase();
  const selected = needle
    ? repos.filter((repo) => repo.name.toLowerCase().includes(needle) || repo.url.toLowerCase().includes(needle))
    : repos;
  if (selected.length === 0) throw new Error(`No rows in ${csvPath} match ${only ?? "(all)"}`);
  return selected;
}
