import { DEFAULT_BUDGET, DEFAULT_TARGET, MAX_CONCURRENCY } from "./limits.js";
import type { CliOptions, Setup } from "./types.js";

const FLAGS = new Set([
  "--setup",
  "--model",
  "--budget",
  "--concurrency",
  "--target",
  "--retry",
]);

function takeValue(argv: string[], index: number, flag: string): string {
  const inline = argv[index].indexOf("=");
  if (inline >= 0) return argv[index].slice(inline + 1);
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseArgs(argv: string[]): CliOptions {
  let setup: Setup | undefined;
  let model: string | undefined;
  let budget = DEFAULT_BUDGET;
  let concurrency = 1;
  let target = DEFAULT_TARGET;
  let retry = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") continue;
    const flag = token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
    if (!flag.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    if (!FLAGS.has(flag)) {
      throw new Error(`Unknown flag: ${flag}`);
    }
    if (flag === "--retry") {
      if (token.includes("=")) throw new Error("--retry does not take a value");
      retry = true;
      continue;
    }
    const value = takeValue(argv, i, flag);
    if (!token.includes("=")) i += 1;
    if (flag === "--setup") {
      if (value !== "env" && value !== "h1" && value !== "h2") {
        throw new Error("--setup must be env, h1, or h2");
      }
      setup = value;
    } else if (flag === "--model") {
      model = value;
    } else if (flag === "--budget") {
      budget = Number(value);
      if (!Number.isInteger(budget) || budget < 1) {
        throw new Error("--budget must be a positive integer");
      }
    } else if (flag === "--concurrency") {
      concurrency = Number(value);
      if (!Number.isInteger(concurrency) || concurrency < 1) {
        throw new Error("--concurrency must be a positive integer");
      }
      if (concurrency > MAX_CONCURRENCY) {
        throw new Error(`--concurrency must be ${MAX_CONCURRENCY} or below`);
      }
    } else if (flag === "--target") {
      if (value !== "17" && value !== "21") {
        throw new Error("--target must be 17 or 21");
      }
      target = value;
    }
  }

  if (!setup) throw new Error("--setup is required");
  return { setup, model, budget, concurrency, target, retry };
}
