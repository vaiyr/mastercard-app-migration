import type { Setup } from "./types.js";

export function promptFor(setup: Setup, target: string, budget: number): string {
  if (setup === "env") {
    return [
      "Environment check only. Do not edit, create, or delete any file. Do not commit.",
      "Run these commands and include their full output in your reply:",
      "1. JAVA_HOME=/opt/java/temurin-8 mvn -v",
      "2. JAVA_HOME=/opt/java/temurin-17 mvn -v",
      "Then stop.",
    ].join("\n");
  }
  const lookup =
    setup === "h1"
      ? "Use the deps-lookup tool before choosing a library version."
      : "A pre-pass may already have changed pom.xml. Do not expect a lookup server.";
  return [
    `Migrate this Maven project to Java ${target}.`,
    "Follow AGENTS.md and the java17-migration skill.",
    lookup,
    "Do not delete, skip, or rename tests. Do not downgrade a dependency.",
    `The check is: JAVA_HOME=/opt/java/temurin-${target === "21" ? "17" : target} mvn -B clean verify`,
    target === "21"
      ? "The image's newest JDK may be 17. If Java 21 is not installed, say so and stop after recording that."
      : "Use the Temurin 17 home above for the verify command.",
    `Stop after ${budget} tool calls or when verify succeeds.`,
    "Do not claim the migration passed. List remaining compiler and test errors.",
  ].join("\n");
}

export function retryPrompt(failureList: string): string {
  return [
    "The external grader failed this migration. Keep the current branch and fix only the listed failures.",
    "Do not delete, skip, or rename tests. Do not downgrade a dependency.",
    "Failures:",
    failureList,
  ].join("\n");
}
