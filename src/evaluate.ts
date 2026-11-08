import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { classMajor } from "./limits.js";

const execFileAsync = promisify(execFile);

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export function migrationBenchRoot(): string {
  const root = process.env.HARNESS_MIGRATIONBENCH;
  if (!root) {
    throw new Error("Set HARNESS_MIGRATIONBENCH to a clone of amazon-science/MigrationBench");
  }
  return root;
}

export function pythonBin(): string {
  return process.env.HARNESS_PYTHON || "python3";
}

/** The published evaluator image hardcodes an arm64 JAVA_HOME. Point it at amd64 on x64 hosts. */
export async function patchEvaluatorDockerfile(root: string): Promise<string | null> {
  const dockerfile = path.join(root, "Dockerfile");
  const text = await readFile(dockerfile, "utf8");
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const wrong = arch === "amd64" ? "java-17-openjdk-arm64" : "java-17-openjdk-amd64";
  const right = `java-17-openjdk-${arch}`;
  if (!text.includes(wrong)) return null;
  await writeFile(dockerfile, text.replaceAll(wrong, right));
  return `Patched evaluator Dockerfile JAVA_HOME to ${right}`;
}

export async function ensureEvaluatorReady(): Promise<string[]> {
  const root = migrationBenchRoot();
  const runEval = path.join(root, "src", "migration_bench", "run_eval.py");
  if (!(await exists(runEval))) {
    throw new Error(`run_eval.py not found in ${root}`);
  }
  return ["Grader is python -m migration_bench.run_eval with JAVA_HOME=/opt/java/temurin-17. No Docker image."];
}

export interface EvalRequest {
  githubUrl: string;
  baseCommit: string;
  diffPath: string;
  target: string;
  maximal: boolean;
}

export async function runEval(request: EvalRequest): Promise<{ log: string; passed: boolean }> {
  const root = migrationBenchRoot();
  const moduleArgs = [
    "-m",
    "migration_bench.run_eval",
    "--github_url",
    request.githubUrl,
    "--git_diff_filename",
    request.diffPath,
    "--base_commit_id",
    request.baseCommit,
    "--require_compiled_java_major_version",
    String(classMajor(request.target)),
    "--is_maximal_migration",
    request.maximal ? "1" : "0",
  ];
  const javaHome = "/opt/java/temurin-17";
  const { stdout, stderr } = await execFileAsync(pythonBin(), moduleArgs, {
    cwd: root,
    timeout: 60 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      JAVA_HOME: javaHome,
      PATH: `${javaHome}/bin:/opt/maven/bin:${process.env.PATH ?? ""}`,
      PYTHONPATH: [path.join(root, "src"), process.env.PYTHONPATH].filter(Boolean).join(":"),
    },
  }).catch((error: NodeJS.ErrnoException & { stdout?: string; stderr?: string }) => {
    return {
      stdout: error.stdout ?? "",
      stderr: `${error.stderr ?? ""}\n${error.message}`,
    };
  });
  const log = `${stdout ?? ""}\n${stderr ?? ""}`;
  const passed = /Migration success \(count\) `True`/.test(log);
  return { log, passed };
}
