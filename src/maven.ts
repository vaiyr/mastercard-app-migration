import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { javaEnv } from "./env.js";

const execFileAsync = promisify(execFile);

const ERROR_LINE = /\[ERROR\]|BUILD FAILURE|COMPILATION ERROR|Failed tests:|Tests run:|There are test failures/;

/** Keep the compiler and test failure lines. Falls back to the log tail when there are none. */
export function extractMavenErrors(log: string, limit = 20_000): string {
  const lines = log.split("\n").map((line) => line.trimEnd()).filter((line) => ERROR_LINE.test(line));
  const body = (lines.length > 0 ? lines.join("\n") : log.trim().slice(-8_000)).trim();
  if (!body) return "Maven exited without output.";
  return body.slice(0, limit);
}

/** Run `mvn clean verify` on Java 17 against a local checkout and return what failed. */
export async function captureMavenErrors(checkout: string): Promise<{ full: string; errors: string }> {
  const local = path.join(tmpdir(), "migration-harness-m2");
  let full: string;
  try {
    const { stdout, stderr } = await execFileAsync(
      "mvn",
      ["-B", "-DtrimStackTrace=false", `-Dmaven.repo.local=${local}`, "clean", "verify"],
      { cwd: checkout, timeout: 20 * 60_000, maxBuffer: 64 * 1024 * 1024, env: javaEnv() },
    );
    full = `${stdout}\n${stderr}`;
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message?: string };
    full = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}\n${failed.message ?? ""}`;
  }
  return { full, errors: extractMavenErrors(full) };
}
