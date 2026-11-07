export const MAX_CONCURRENCY = 5;
export const DEFAULT_BUDGET = 80;
export const MAX_MINUTES = 45;
export const DEFAULT_TARGET = "17";

export const HARNESS_PATHS = [".cursor/", "AGENTS.md", "tools/"] as const;

export function classMajor(target: string): number {
  if (target === "21") return 65;
  if (target === "17") return 61;
  throw new Error(`Unsupported Java target: ${target}`);
}
