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

## Live extension

A live demo uses `--concurrency 1`. The same commands cover one repo or many, `--setup h1` or `--setup h2`, any catalog model id, and a run with or without `--retry`. Secrets stay placeholders. Do not add mockito or awaitility pins.

Save this as `issuing.csv`. The base commit is the cohort pin for `Mastercard/issuing-api-reference-app`.

```csv
github_url,base_commit
https://github.com/Mastercard/issuing-api-reference-app,3a39022355340848fd04d275964388d8739ea89b
```

One repo does not need `HARNESS_ALLOW_MANY`. H2 is the kept path, so leave the error pre-pass on.

```bash
export CURSOR_API_KEY=...
export CURSOR_ADMIN_API_KEY=...
export HARNESS_GITHUB_TOKEN=...
export HARNESS_FORK_OWNER=your-user
export HARNESS_REPOS=./issuing.csv
export HARNESS_VERSIONS=./versions.json
export HARNESS_MIGRATIONBENCH=/path/to/MigrationBench
export HARNESS_ERROR_PREPASS=1
npm run harness -- --setup h2 --model composer-2.5 --concurrency 1 --target 17
```

The r5 follow-up is that same command with `--retry`. The harness grades first and, on a maximal miss, sends the failed checks back to that agent once.

```bash
npm run harness -- --setup h2 --model composer-2.5 --concurrency 1 --target 17 --retry
```

H1 is the same demo with the agent editing and testing, and no pom pre-pass:

```bash
npm run harness -- --setup h1 --model composer-2.5 --concurrency 1 --target 17
```

Swap the catalog id. Each of these is `fast=false` when the model has that parameter:

```bash
npm run harness -- --setup h2 --model composer-2.5 --concurrency 1 --target 17
npm run harness -- --setup h2 --model grok-4.7 --concurrency 1 --target 17
npm run harness -- --setup h2 --model claude-opus-5-5 --concurrency 1 --target 17
```

Any other id from `Cursor.models.list()` is the same `--model` flag.

Another repo is another `github_url` and `base_commit`. Point `HARNESS_REPOS` at that file:

```csv
github_url,base_commit
https://github.com/OWNER/REPO,BASE_COMMIT
```

```bash
export HARNESS_REPOS=./other.csv
npm run harness -- --setup h2 --model composer-2.5 --concurrency 1 --target 17
```

Many repos are more rows in one CSV. Set `HARNESS_ALLOW_MANY=1`. Keep `--concurrency 1` so a live demo still runs one agent at a time. `HARNESS_REPO_MATCH` selects a single row from that file when you want one of them.

```bash
export HARNESS_REPOS=./repos.csv
export HARNESS_ALLOW_MANY=1
npm run harness -- --setup h2 --model composer-2.5 --concurrency 1 --target 17
```
