import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { javaEnv } from "./env.js";
import type { Verdict } from "./types.js";

const execFileAsync = promisify(execFile);
const GRADER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "grader", "grade.py");

export function classMajor(target: string): number {
  if (target === "21") return 65;
  if (target === "17") return 61;
  throw new Error(`Unsupported Java target ${target}`);
}

export function failedVerdict(error: string): Verdict {
  return {
    r1: false, r2: false, r3: false, r4: false, r5: false,
    minimal: false, maximal: false,
    classMajors: [], tests: null, testsRequired: -10, testsBaseline: "none",
    trackedDependencies: 0, dependencyMisses: [], diffApplied: false,
    error,
  };
}

/** Parse the grader's stdout. The JSON object is its last non-empty line. */
export function parseGraderOutput(stdout: string): Verdict {
  const line = stdout.trim().split("\n").filter(Boolean).pop();
  if (!line) return failedVerdict("grader printed nothing");
  try {
    return JSON.parse(line) as Verdict;
  } catch {
    return failedVerdict(`grader output was not JSON: ${line.slice(0, 200)}`);
  }
}

/** Run grader/grade.py outside the agent VM, on the local Java 17. Writes the grader log next to the diff. */
export async function gradeDiff(input: {
  githubUrl: string;
  baseCommit: string;
  diffPath: string;
  target: string;
  logPath: string;
  /** r4 baseline when the manifest knows it; otherwise the grader measures it at the base commit. */
  testsRequired?: number;
  baselineCache: string;
}): Promise<Verdict> {
  const python = process.env.GRADER_PYTHON || path.resolve(".venv", "bin", "python");
  const args = [
    GRADER,
    "--github-url", input.githubUrl,
    "--base-commit", input.baseCommit,
    "--diff", input.diffPath,
    "--class-major", String(classMajor(input.target)),
    "--baseline-cache", input.baselineCache,
    ...(input.testsRequired !== undefined ? ["--tests-required", String(input.testsRequired)] : []),
    ...(process.env.JAVA8_HOME ? ["--java8-home", process.env.JAVA8_HOME] : []),
  ];
  const env = javaEnv();
  let stdout = "";
  let stderr = "";
  try {
    ({ stdout, stderr } = await execFileAsync(python, args, { env, timeout: 60 * 60_000, maxBuffer: 64 * 1024 * 1024 }));
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message?: string };
    stdout = failed.stdout ?? "";
    stderr = `${failed.stderr ?? ""}\n${failed.message ?? ""}`;
  }
  await writeFile(input.logPath, `${stderr}\n----- stdout -----\n${stdout}`);
  return parseGraderOutput(stdout);
}
