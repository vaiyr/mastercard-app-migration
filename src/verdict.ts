export interface ParsedVerdict {
  maximal: boolean | null;
  minimal: boolean | null;
  buildSuccess: boolean | null;
  testCount: number | null;
  r1: boolean | null;
  r2: boolean | null;
  r3: boolean | null;
  r4: boolean | null;
  r5: boolean | null;
  r1r2Combined: boolean;
  dependencyFailures: string[];
  notes: string[];
}

const SUCCESS_LINE =
  /\[single(?:-docker)?\] Migration success \(count\) `(True|False)`/;
const BUILD_LINE =
  /Repo \(Build success, #tests\) = \((True|False), ([^)]*)\)/;
const FINAL_LINE = /Final eval for `[^`]*` \([^)]*\): Success = (True|False)\./;

/** True when the evaluator printed a success or failure count, not when the migration passed. */
export function graderReported(log: string): boolean {
  return SUCCESS_LINE.test(log) || FINAL_LINE.test(log);
}

/**
 * `--setup env` checks that both JDKs printed Maven 3.9.6 and that the grader ran.
 * An unmigrated tree is graded False. That is a completed check.
 */
export function envProofGap(ndjson: string, evalLog: string): string | null {
  const java8 = /Java version: 1\.8\.0/.test(ndjson);
  const java17 = /Java version: 17\.0/.test(ndjson);
  const maven = ndjson.split("Apache Maven 3.9.6").length > 2;
  const grader = graderReported(evalLog);
  if (java8 && java17 && maven && grader) return null;
  return `env proof incomplete: java8=${java8} java17=${java17} maven=${maven} grader=${grader}`;
}

function flag(value: string | undefined): boolean | null {
  if (value === "True") return true;
  if (value === "False") return false;
  return null;
}

export function parseEvalLog(maximalLog: string, minimalLog?: string): ParsedVerdict {
  const notes: string[] = [];
  const maximalMatch = maximalLog.match(SUCCESS_LINE);
  const minimalSource = minimalLog ?? "";
  const minimalMatch = minimalSource.match(SUCCESS_LINE);
  const buildSource = minimalLog || maximalLog;
  const buildMatch = buildSource.match(BUILD_LINE);
  const buildSuccess = flag(buildMatch?.[1]);
  const testRaw = buildMatch?.[2]?.trim();
  const testCount = testRaw && /^-?\d+$/.test(testRaw) ? Number(testRaw) : null;
  const dependencyFailures = [
    ...maximalLog.matchAll(/"dependency": "([^"]+)"/g),
  ].map((match) => match[1]);

  const maximal = flag(maximalMatch?.[1] ?? maximalLog.match(FINAL_LINE)?.[1]);
  const minimal = minimalLog
    ? flag(minimalMatch?.[1] ?? minimalLog.match(FINAL_LINE)?.[1])
    : null;

  let r5: boolean | null = null;
  if (buildSuccess === true && maximal === true) r5 = true;
  else if (buildSuccess === true && maximal === false) r5 = false;
  else if (dependencyFailures.length > 0) r5 = false;

  let r3: boolean | null = null;
  let r4: boolean | null = null;
  if (minimal === true || (minimal === null && maximal === true)) {
    r3 = true;
    r4 = true;
  } else if (buildSuccess === true && (minimal === false || maximal === false)) {
    const unconstrained = /Required #tests = `-?\d+`/.test(buildSource)
      ? /Required #tests = `-\d+`/.test(buildSource)
      : false;
    if (unconstrained) {
      r4 = true;
      r3 = false;
      notes.push("Test-count check is unconstrained for this repository, so a failed invariant is treated as r3.");
    } else {
      r3 = null;
      r4 = null;
      notes.push("Build succeeded and the overall verdict failed. r3 and r4 are not separated in the evaluator log.");
    }
  }

  if (!maximalMatch && !maximalLog.match(FINAL_LINE)) {
    notes.push("Evaluator log has no success line.");
  }

  return {
    maximal,
    minimal,
    buildSuccess,
    testCount,
    r1: buildSuccess,
    r2: buildSuccess,
    r3,
    r4,
    r5,
    r1r2Combined: true,
    dependencyFailures,
    notes,
  };
}

export function verdictPassed(log: string): boolean {
  return parseEvalLog(log).maximal === true;
}
