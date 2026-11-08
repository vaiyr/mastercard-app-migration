#!/usr/bin/env python3
"""Grade one migration diff with MigrationBench, one criterion at a time.

MigrationBench's run_eval prints a single pass or fail. This script calls the
same library functions in the same order and reports each check separately:

  r1  mvn clean verify passes on the target JDK
  r2  every compiled class has the target major version (61 for Java 17)
  r3  the set of test methods is unchanged
  r4  the test count did not drop below the dataset's count
  r5  every tracked dependency is at its latest major (the maximal migration rule)

Prints one JSON object on stdout. Logs go to stderr. Run with the python that
has MigrationBench installed; JAVA_HOME and mvn must point at Java 17.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import tempfile

import git

from migration_bench.common import eval_utils, git_repo, hash_utils, maven_utils, utils
from migration_bench.eval import final_eval
from migration_bench.lang.java.eval import parse_file, parse_repo

LHS_BRANCH = final_eval.LHS_BRANCH


def dependency_misses(root: str) -> tuple[list[dict], int]:
    """eval_utils.check_version, but returning the failing list instead of a bool."""
    import glob

    tracked = set()
    for pom in glob.glob(os.path.join(root, "**", "pom.xml"), recursive=True):
        tracked.update(eval_utils.extract_dependencies(pom))
    tree = eval_utils.generate_dependency_tree(root)
    if not tree:
        return [{"dependency": "dependency:tree failed"}], 0
    effective = eval_utils.get_effective_versions(tree, tracked)
    expected = utils.load_json(eval_utils.DEPENDENCY_VERSION) or {}
    misses = []
    for dep, got in effective.items():
        want = expected.get(dep)
        if want is None:
            continue
        if not eval_utils.compare_major_versions(got, want):
            misses.append({"dependency": dep, "expected": want, "got": got})
    os.remove(tree)
    return misses, len(effective)


def error_lines(log: str, limit: int = 40) -> list[str]:
    """The compiler and test failure lines from a Maven log, for the report."""
    keep = ("[ERROR]", "BUILD FAILURE", "COMPILATION ERROR", "Tests run:", "Failed tests")
    lines = [line.rstrip() for line in log.splitlines() if any(k in line for k in keep)]
    return lines[:limit]


def test_set_changes(root: str) -> list[str]:
    """Why r3 failed, in words: test files added or removed, and methods added or removed per file."""
    before = parse_repo.get_repo_test_files(root, LHS_BRANCH) or {}
    after = parse_repo.get_repo_test_files(root) or {}
    rel = lambda path: os.path.relpath(path, root)
    changes = []
    for path in sorted(set(after) - set(before)):
        changes.append(f"added test file {rel(path)}")
    for path in sorted(set(before) - set(after)):
        changes.append(f"removed test file {rel(path)}")
    for path in sorted(set(before) & set(after)):
        lhs, rhs = before[path], after[path]
        if lhs is None or rhs is None:
            if lhs != rhs:
                changes.append(f"{rel(path)} no longer parses as Java")
            continue
        if lhs == rhs:
            continue
        names = lambda nodes: {node[1][0] if node[0] == parse_file.METHOD else node[1] for node in nodes}
        gone = sorted(names(lhs) - names(rhs))
        new = sorted(names(rhs) - names(lhs))
        if gone:
            changes.append(f"{rel(path)}: removed or renamed {', '.join(gone)}")
        if new:
            changes.append(f"{rel(path)}: added {', '.join(new)}")
        if not gone and not new:
            changes.append(f"{rel(path)}: a method lost or gained its @Test annotation")
    return changes


def grade(github_url: str, base_commit: str, diff_file: str, class_major: int) -> dict:
    with tempfile.TemporaryDirectory() as root:
        local = git.Repo.clone_from(github_url, root)
        local.git.checkout(base_commit)
        repo = git_repo.GitRepo(root)
        repo.new_branch(LHS_BRANCH)
        if os.path.getsize(diff_file) > 0:
            repo.apply(diff_file)
        applied = len(local.git.status("--porcelain").splitlines()) > 0

        verify = maven_utils.do_run_maven_command(
            maven_utils.MVN_CLEAN_VERIFY.format(root_dir=root), check=False
        )
        r1 = verify.return_code == 0
        verify_errors = [] if r1 else error_lines(verify.stdout or "")
        majors = sorted(utils.get_compiled_java_major_versions(root)) if r1 else []
        r2 = r1 and majors == [class_major]
        misses, tracked = dependency_misses(root) if r1 else ([], 0)
        r5 = r1 and not misses

        required = final_eval.DATASET_NUM_TESTS.get(
            github_url, final_eval.DATASET_NUM_TESTS.get(final_eval.alias(github_url), -10)
        )
        tests_run = maven_utils.do_run_maven_command(
            maven_utils.MVN_NUM_TESTS.format(root_dir=root), check=False
        )
        tests = hash_utils.get_num_test_cases(root, tests_run.stdout)
        r4 = required < 0 or (tests is not None and tests >= required)
        r3 = bool(parse_repo.same_repo_test_files(root, lhs_branch=LHS_BRANCH)[-1])
        test_changes = [] if r3 else test_set_changes(root)

    return {
        "r1": r1, "r2": r2, "r3": r3, "r4": r4, "r5": r5,
        "minimal": r1 and r2 and r3 and r4,
        "maximal": r1 and r2 and r3 and r4 and r5,
        "classMajors": majors,
        "tests": tests, "testsRequired": required,
        "trackedDependencies": tracked, "dependencyMisses": misses,
        "diffApplied": applied,
        "verifyErrors": verify_errors,
        "testSetChanges": test_changes,
    }


def official(github_url: str, base_commit: str, diff_file: str, class_major: int) -> dict:
    """The stock MigrationBench verdicts, for checking that grade() agrees."""
    out = {}
    for name, maximal in (("maximal", 1), ("minimal", 0)):
        out[name] = bool(final_eval.run_eval(
            github_url, diff_file, None, commit_id=base_commit,
            require_maximal_migration=maximal,
            require_compiled_java_major_version=class_major,
        ))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--github-url", required=True)
    parser.add_argument("--base-commit", required=True)
    parser.add_argument("--diff", required=True, help="git diff from the base commit; may be empty")
    parser.add_argument("--class-major", type=int, default=61, help="61 for Java 17, 65 for Java 21")
    parser.add_argument("--official", action="store_true", help="also run MigrationBench run_eval and report agreement")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format=utils.LOGGING_FORMAT, stream=sys.stderr)

    args.diff = os.path.abspath(args.diff)
    result = grade(args.github_url, args.base_commit, args.diff, args.class_major)
    if args.official:
        result["official"] = official(args.github_url, args.base_commit, args.diff, args.class_major)
        result["agreesWithOfficial"] = (
            result["official"]["maximal"] == result["maximal"]
            and result["official"]["minimal"] == result["minimal"]
        )
    print(json.dumps(result))


if __name__ == "__main__":
    main()
