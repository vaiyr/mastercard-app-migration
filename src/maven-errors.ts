import { execFile } from "node:child_process";
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
  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${checkout}:/workspace`,
        "-w",
        "/workspace",
        "-u",
        "1000:1000",
        "migration-bench:latest",
        "mvn",
        "-B",
        "-DtrimStackTrace=false",
        "clean",
        "verify",
      ],
      { timeout: 20 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 },
    );
    full = `${stdout ?? ""}\n${stderr ?? ""}`;
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message?: string };
    full = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}\n${failed.message ?? ""}`;
  }
  return { full, errors: extractMavenErrors(full) };
}
