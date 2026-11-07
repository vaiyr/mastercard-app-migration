# Cloud agent instructions

## Runtime

- Java 8 (baseline only): `/opt/java/temurin-8`
- Java 17 (required runtime): `/opt/java/temurin-17`
- Maven 3.9.6: `/opt/maven` (`mvn` on `PATH`)
- `mvn -v` follows `JAVA_HOME`. A shared local repository is `/var/maven/repository`.

## Which run this is

Read `.cursor/harness-setup`.

- `env`: run only the two `mvn -v` commands from the prompt. Do not edit, create, or delete files. Do not commit.
- `h1`: migrate the project, then verify. Use the `java17-migration` skill and the `deps-lookup` tool before choosing a library version.
- `h2`: a pre-pass may already have edited `pom.xml`. Repair the build and verify. Do not expect a dependency lookup server.

The Java release to land on is in `.cursor/harness-target`.

## Verify

```bash
JAVA_HOME=/opt/java/temurin-17 mvn -B clean verify
```

Do not pass `-DskipTests` or `-Dmaven.test.skip`. Do not delete, rename, or comment out tests. Do not lower a dependency version.

## Budget

Stop when the prompt's tool-call budget is reached. A green verify on the target JDK is the stopping point. Do not keep rewriting after that.

## Output

An external grader decides pass or fail after this run. End with the remaining compiler and test errors. Do not state that the migration passed.
