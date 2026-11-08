# Instructions for the migration agent

You are migrating this Maven project from Java 8 to the release named in `.cursor/harness-target` (17 unless told otherwise). An external grader decides pass or fail after you finish, so do not claim success; end with the compiler and test errors that remain, if any.

## Toolchain

The VM starts without Java. Before any Maven command run:

```bash
bash .cursor/bootstrap-jdks.sh
```

That installs Temurin 8 at `/opt/java/temurin-8`, Temurin 17 at `/opt/java/temurin-17`, and Maven 3.9.6 at `/opt/maven`. `mvn -v` reports whichever `JAVA_HOME` you set.

## Which setup this run uses

`.cursor/harness-setup` says `h1` or `h2`.

- `h1`: you do the whole migration. Call the `lookup_dependency` tool before you pick any library version, and follow the `java17-migration` skill.
- `h2`: `tools/bump_poms.py` already raised the versions in `pom.xml`. Your job is to repair the build that results. There is no lookup tool in this setup.

## The check

```bash
JAVA_HOME=/opt/java/temurin-17 mvn -B clean verify
```

Never pass `-DskipTests` or `-Dmaven.test.skip`. Never delete, rename, or comment out a test. Never lower a dependency version. A hook blocks these; do not work around it.

## When to stop

Stop when verify is green on Java 17, or when you reach the tool-call budget in the prompt. Do not keep rewriting after a green verify.

Commit your changes with git before you stop. The grader reads the branch this run pushes; uncommitted edits are lost.
