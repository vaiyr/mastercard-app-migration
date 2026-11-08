import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ERROR_LINE =
  /\[ERROR\]|BUILD FAILURE|COMPILATION ERROR|Failed tests:|Tests run:|There are test failures/;

/** Keep compiler and test failures. A log with no error lines is not rewritten into a success. */
export function extractMavenErrors(log: string, limit = 20_000): string {
  const interesting = log
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => ERROR_LINE.test(line));
  const body = (interesting.length > 0 ? interesting.join("\n") : log.trim().slice(-8_000)).trim();
  if (!body) return "Maven exited without output.";
  return body.length <= limit ? body : body.slice(0, limit);
}

export async function captureMavenErrors(checkout: string): Promise<{ full: string; errors: string }> {
  let full = "";
  const javaHome = process.env.HARNESS_PREPASS_JAVA_HOME || "/opt/java/temurin-17";
  const mvn = process.env.HARNESS_MVN || "/opt/maven/bin/mvn";
  const repoLocal = path.join(tmpdir(), "migration-harness-m2", path.basename(checkout) || "repo");
  try {
    const { stdout, stderr } = await execFileAsync(
      mvn,
      ["-B", "-DtrimStackTrace=false", `-Dmaven.repo.local=${repoLocal}`, "clean", "verify"],
      {
        cwd: checkout,
        timeout: 20 * 60 * 1000,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          JAVA_HOME: javaHome,
          PATH: `${javaHome}/bin:/opt/maven/bin:${process.env.PATH ?? ""}`,
        },
      },
    );
    full = `${stdout ?? ""}\n${stderr ?? ""}`;
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message?: string };
    full = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}\n${failed.message ?? ""}`;
  }
  return { full, errors: extractMavenErrors(full) };
}
