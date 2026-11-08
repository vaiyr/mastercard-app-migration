# Migration harness

H1: the agent edits and tests. H2: a script bumps `pom.xml`, and the agent repairs from the compiler errors.

Train, Composer 2.5, chose H2: 7/12 for $1.35 against 8/12 for $1.23. The kept path, one retry then the error pre-pass, reached 11/12 for $2.62. Mastercard apps were not used to choose the setup.

On the Mastercard apps in this vaiyr rerun, Composer H2 greened rp and idassist. Issuing missed r5 on `mockito-core` and `awaitility`, and one retry of that agent went r1–r5 green for about $0.08.

Opus and Grok do not replace that. This rerun Opus greened rp and idassist and missed issuing r5. Grok 4.7 H2 was red on all three.

## Reproduce a run

Use your own Cursor key, your own GitHub user, and the SDK. Forks are private repos on that user (`POST /user/repos`). Set `HARNESS_FORK_OWNER` to your login. JDKs come from `.cursor/bootstrap-jdks.sh` on a plain machine. This harness does not attach a saved image and does not set `cloud.env`.

The grader is `python -m migration_bench.run_eval` on the machine that launches the harness, not inside the agent VM. It does not use Docker. Install Temurin 8, Temurin 17, and Maven 3.9.6 first with the bootstrap script so `JAVA_HOME=/opt/java/temurin-17` and `/opt/maven/bin/mvn` exist. The same homes are what an agent installs when they are missing. `HARNESS_ERROR_PREPASS=1` runs Maven once on the H2 tree and puts those compiler and test errors in the first prompt.

`getUsage()` zeros are not the cost. The report's `chargedCents` comes from `POST /teams/filtered-usage-events` with `CURSOR_ADMIN_API_KEY` as Basic auth (key as the username, empty password), matched by `cloudAgentId`.

```bash
npm install
bash .cursor/bootstrap-jdks.sh
export CURSOR_API_KEY=...            # your Cursor key, used to create agents
export CURSOR_ADMIN_API_KEY=...      # ledger only
export HARNESS_GITHUB_TOKEN=...      # your GitHub user
export HARNESS_FORK_OWNER=your-user
export HARNESS_REPOS=./repos.csv     # columns github_url and base_commit
export HARNESS_VERSIONS=./versions.json
export HARNESS_MIGRATIONBENCH=/path/to/MigrationBench
export HARNESS_ALLOW_MANY=1
export HARNESS_ERROR_PREPASS=1
npm run harness -- --setup h2 --model composer-2.5 --concurrency 5 --target 17
```

`--model` must be a catalog id from `Cursor.models.list()`. The pin uses `fast=false` when that parameter exists. `--concurrency` stays at 5 or below. `--budget` defaults to 80 tool calls. `--retry` sends the failed check list back to the same agent once.

`--setup h1` lets the agent migrate, with a dependency lookup server. `--setup h2` runs `tools/deps-prepass.py` before the agent and does not attach that server. Do not add mockito or awaitility pins on top of your version file to chase the issuing miss.

Node.js 22.13 or newer. Reports go to `HARNESS_OUT` (default `./out`). Do not commit them.

| Variable | Purpose |
| --- | --- |
| `HARNESS_FORK_OWNER` | Your GitHub user. Required. A user is created with `POST /user/repos` |
| `HARNESS_REPOS` | CSV with `github_url` and `base_commit` |
| `HARNESS_ALLOW_MANY` | Set to `1` to run every selected row |
| `HARNESS_VERSIONS` | JSON object of `group:artifact` to version |
| `HARNESS_MIGRATIONBENCH` | Path to a MigrationBench clone |
| `HARNESS_PYTHON` | Python used for `python -m migration_bench.run_eval` |
| `CURSOR_API_KEY` | Creates the cloud agents |
| `CURSOR_ADMIN_API_KEY` | Ledger Basic auth only |
