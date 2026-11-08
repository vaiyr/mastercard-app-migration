import type { Setup, Verdict } from "./types.js";

export function firstPrompt(setup: Setup, target: string, budget: number, branch: string): string {
  const lines = [
    `Migrate this Maven project to Java ${target}. Read AGENTS.md first.`,
    `First command: git checkout -b ${branch}`,
    "The VM has no Java yet: run `bash .cursor/bootstrap-jdks.sh` before any Maven command.",
    setup === "h1"
      ? "Use the lookup_dependency tool before choosing any library version, and follow the java17-migration skill."
      : "tools/bump_poms.py already raised the versions in pom.xml. Repair the build that results. There is no lookup tool.",
    "Do not delete, skip, or rename tests. Do not lower a dependency version.",
    `The check is: JAVA_HOME=/opt/java/temurin-17 mvn -B clean verify`,
    target === "21" ? "If Java 21 is not installed, say so and stop." : "",
    `Stop after ${budget} tool calls or when verify is green.`,
    `Last step, always, even if verify still fails: git add -A && git commit -m "Migrate to Java ${target}" && git push origin ${branch}. Only what is pushed to ${branch} reaches the grader.`,
    "An external grader decides the result. Do not claim the migration passed; end with the compiler and test errors that remain.",
  ];
  return lines.filter(Boolean).join("\n");
}

/** What the grader found, in words the agent can act on. */
export function failureList(verdict: Verdict): string {
  const lines: string[] = [];
  if (!verdict.r1) lines.push("r1 FAIL: `mvn clean verify` does not pass on Java 17.");
  if (verdict.r1 && !verdict.r2) {
    lines.push(`r2 FAIL: compiled classes have major versions ${verdict.classMajors.join(", ")}; every class must be 61 (Java 17).`);
  }
  if (!verdict.r3) {
    lines.push("r3 FAIL: the test files and test methods must be exactly the original set. No new files under src/test, no removed or renamed methods. Found:");
    for (const change of verdict.testSetChanges ?? ["(details unavailable)"]) lines.push(`  ${change}`);
  }
  if (!verdict.r4) {
    lines.push(`r4 FAIL: ${verdict.tests ?? "no"} tests ran; at least ${verdict.testsRequired} must run.`);
  }
  if (verdict.r1 && !verdict.r5) {
    lines.push("r5 FAIL: these dependencies are below their required major version:");
    for (const miss of verdict.dependencyMisses) {
      lines.push(`  ${miss.dependency}: have ${miss.got ?? "?"}, need major ${miss.expected ?? "?"} or newer`);
    }
  }
  return lines.join("\n");
}

export function retryPrompt(verdict: Verdict, branch: string): string {
  return [
    `The external grader failed this migration. Stay on branch ${branch} and fix only what is listed below.`,
    "Do not delete, skip, or rename tests. Do not lower a dependency version.",
    `Then run JAVA_HOME=/opt/java/temurin-17 mvn -B clean verify and, whatever the result: git add -A && git commit -m "Fix grader failures" && git push origin ${branch}`,
    "",
    failureList(verdict),
  ].join("\n");
}

export function pushNudge(branch: string, target: string): string {
  return `Nothing has reached the remote branch ${branch}. Run exactly: git add -A; git commit -m "Migrate to Java ${target}"; git push origin HEAD:${branch}. Then stop. Do not change any file.`;
}

/** The pull request body: what was checked, what it cost, where the agent ran. */
export function pullRequestBody(input: { setup: Setup; model: string; target: string; verdict: Verdict; calls: number; minutes: number; cents: number | null; agentUrl: string; retried: boolean }): string {
  const v = input.verdict;
  const mark = (ok: boolean) => (ok ? "pass" : "fail");
  return [
    `Java ${input.target} migration by a Cursor cloud agent (${input.model}, setup ${input.setup.toUpperCase()}${input.retried ? ", one verifier retry" : ""}).`,
    "",
    "| Check | Result |",
    "| --- | --- |",
    `| r1 \`mvn clean verify\` on Java ${input.target} | ${mark(v.r1)} |`,
    `| r2 compiled class major ${v.classMajors.join(", ") || "?"} | ${mark(v.r2)} |`,
    `| r3 test files and methods unchanged | ${mark(v.r3)} |`,
    `| r4 tests run: ${v.tests ?? "?"}${v.testsRequired >= 0 ? ` (baseline ${v.testsRequired})` : " (no baseline)"} | ${mark(v.r4)} |`,
    `| r5 ${v.trackedDependencies} tracked dependencies at latest major | ${mark(v.r5)} |`,
    "",
    `Agent: ${input.calls} tool calls, ${input.minutes} minutes, ${input.cents === null ? "cost pending" : `$${(input.cents / 100).toFixed(2)}`} charged. ${input.agentUrl}`,
    input.setup === "h2" ? "The base branch already carries the pom version rewrite from `tools/bump_poms.py`; this diff is the agent's repair on top of it." : "",
  ].filter((line) => line !== "").join("\n");
}
