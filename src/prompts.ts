import type { Setup, Verdict } from "./types.js";

export function firstPrompt(setup: Setup, target: string, budget: number, branch: string, mavenErrors?: string): string {
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
  if (mavenErrors) {
    lines.push(
      "Maven was run once on this tree before your first turn. These are its compiler and test errors. Fix them; a file that is not listed still has to compile.",
      "Errors:",
      mavenErrors,
    );
  }
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
