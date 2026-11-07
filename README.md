# Migration harness

TypeScript orchestrator for one cloud agent per Maven repository. It forks the repo at a pinned commit, commits an environment (Temurin 8, Temurin 17, Maven 3.9.6), streams the run to NDJSON, and grades the source diff with MigrationBench `run_eval.py --use_docker` outside the agent VM.

The agent's own build is not the verdict. `migration-report.json` records the grader's result, tool calls, minutes, UTC `startedAt` and `endedAt` next to the model, the full `getUsage()` object, and its input, output, cache, and total token fields. A missing token or time field is the string `absent`. `chargedCents` can be 0 when usage is included in a plan; the token counts are still recorded.

If the fork's default branch already has a harness commit that descends from the pinned base and the same setup, that commit is kept. A prepaid-balance `usage_limit_exceeded` error stops that run before grading and does not start repositories still waiting in the queue.

## Flags

```bash
npm run harness -- --setup env|h1|h2 --model <catalog-id> --budget <calls> --concurrency <n> --target 17|21 --retry
```

`--concurrency` is capped at 5. `--budget` defaults to 80 tool calls. A run also stops at 45 minutes. `--retry` sends the grader failure list back to the same agent once.

`--setup env` checks the image: the agent prints `mvn -v` under both JDKs, and the grader runs on an empty diff. If those Temurin homes are missing, the agent installs Temurin 8 (1.8.0_432), Temurin 17 (17.0.13), and Maven 3.9.6 at runtime. The Dockerfile still defines the same pins. A result of `False` on that unmigrated tree means the grader ran. `--setup h1` lets the agent migrate, with a dependency lookup server. `--setup h2` runs `tools/deps-prepass.py` during the environment install and does not attach the lookup server.

## Requirements

- Node.js 22.13 or newer
- `CURSOR_API_KEY` (a service-account key with usage-based billing, so `chargedCents` is not stuck at zero)
- A GitHub token that can create public repositories (`HARNESS_GITHUB_TOKEN` or `gh auth token`)
- Docker, for the grader
- A local clone of [amazon-science/MigrationBench](https://github.com/amazon-science/MigrationBench)

## Environment

| Variable | Purpose |
| --- | --- |
| `HARNESS_FORK_OWNER` | GitHub user or organization that receives forks |
| `HARNESS_NAME_DENY` | Comma-separated substrings removed from fork names and rejected in the owner |
| `HARNESS_REPOS` | CSV with `github_url` and `base_commit`. Required unless `--setup env` |
| `HARNESS_REPO_MATCH` | Substring that selects one CSV row |
| `HARNESS_ALLOW_MANY` | Set to `1` to run every selected row |
| `HARNESS_VERSIONS` | JSON object of `group:artifact` to version, copied into the fork for lookup and the pre-pass |
| `HARNESS_VERSION_EXTRAS` | Optional JSON object merged on top of `HARNESS_VERSIONS` |
| `HARNESS_MIGRATIONBENCH` | Path to the MigrationBench clone |
| `HARNESS_PYTHON` | Python used to launch `run_eval.py` |
| `HARNESS_OUT` | Report directory (default `./out`, not committed) |
| `HARNESS_PROBE_URL` | Repository used by `--setup env` |
| `HARNESS_PROBE_SHA` | Commit for the probe repository. Defaults to its `HEAD` |

The model id is taken from `Cursor.models.list()`. Pass `--model` with a catalog id. One id is pinned for the process and stored on the agent metadata.

Reports, streams, and checkouts are written under `HARNESS_OUT`. Do not commit them.
