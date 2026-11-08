#!/usr/bin/env python3
"""Grade one Java migration diff with the five MigrationBench checks.

The checks follow MigrationBench (Amazon Science, KDD 2026) and its reference
dependency table, reimplemented here so the harness has no dependency on that
repository or on its dataset download:

  r1  `mvn clean verify` passes on the target JDK
  r2  every compiled main class has the target major version (61 for Java 17)
  r3  the test files, their classes and their methods are the same set as before
  r4  at least as many tests run as ran at the base commit
  r5  every tracked dependency is at or above its latest major in dependency_version.json

Pass (the "maximal migration") is r1 through r5. The "minimal migration" is r1
through r4. Prints one JSON object on stdout; logs go to stderr.

Environment: JAVA_HOME and `mvn` on PATH must be the target JDK. The r4 baseline
is taken from --tests-required when given, otherwise it is measured by running
`mvn test` at the base commit on --java8-home (falling back to the target JDK)
and cached under --baseline-cache.
"""

from __future__ import annotations

import argparse
import fnmatch
import glob
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

import javalang
from packaging.version import InvalidVersion, Version

HERE = Path(__file__).resolve().parent
DEPENDENCY_VERSIONS = HERE / "dependency_version.json"
MAVEN_TIMEOUT_S = 20 * 60
TEST_DIR = "src/test"

log = logging.getLogger("grade")


def sh(args: list[str], cwd: str, env: dict | None = None, timeout: int = MAVEN_TIMEOUT_S) -> tuple[int, str]:
    """Run a command, return (exit code, combined output)."""
    log.info("CMD %s (cwd %s)", " ".join(args), cwd)
    try:
        done = subprocess.run(args, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", timeout=timeout)
        return done.returncode, done.stdout
    except subprocess.TimeoutExpired as exc:
        return 124, (exc.stdout or "") + f"\n[grader] timed out after {timeout}s"


def mvn(goals: list[str], cwd: str, java_home: str | None = None) -> tuple[int, str]:
    env = dict(os.environ)
    if java_home:
        env["JAVA_HOME"] = java_home
        env["PATH"] = f"{java_home}/bin:{env.get('PATH', '')}"
    sh(["mvn", "-B", "-q", "dependency:resolve"], cwd, env)
    return sh(["mvn", "-B"] + goals, cwd, env)


def error_lines(output: str, limit: int = 40) -> list[str]:
    keep = ("[ERROR]", "BUILD FAILURE", "COMPILATION ERROR", "Tests run:", "Failed tests")
    return [line.rstrip() for line in output.splitlines() if any(k in line for k in keep)][:limit]


# r2 ------------------------------------------------------------------------

def class_majors(root: str) -> set[int]:
    """Major versions of every compiled main class (target/classes), read from the class file header."""
    majors = set()
    for path in glob.glob(os.path.join(root, "**", "target", "classes", "**", "*.class"), recursive=True):
        with open(path, "rb") as handle:
            header = handle.read(8)
        if len(header) == 8 and header[:4] == b"\xca\xfe\xba\xbe":
            majors.add(int.from_bytes(header[6:8], "big"))
    return majors


# r3 ------------------------------------------------------------------------

def test_files(root: str) -> dict[str, tuple | None]:
    """Repo-relative test file -> parsed (classes, methods) tuple, or None when javalang cannot parse it."""
    found = {}
    for path in glob.glob(os.path.join(root, "**", "*.java"), recursive=True):
        rel = os.path.relpath(path, root)
        if ".git" in rel.split(os.sep) or f"/{TEST_DIR}/" not in f"/{rel}" or not fnmatch.fnmatch(os.path.basename(rel), "*.java"):
            continue
        found[rel] = parse_java(path)
    return found


def parse_java(path: str) -> tuple | None:
    """Classes, interfaces, enums and methods in declaration order; methods carry an is-@Test flag (MigrationBench's shape)."""
    try:
        tree = javalang.parse.parse(Path(path).read_text(encoding="utf-8", errors="replace"))
    except Exception:  # javalang raises several unrelated types
        return None
    nodes = []
    for _, node in tree:
        if isinstance(node, (javalang.tree.ClassDeclaration, javalang.tree.InterfaceDeclaration, javalang.tree.EnumDeclaration, javalang.tree.AnnotationDeclaration)):
            nodes.append(("type", node.name))
        elif isinstance(node, javalang.tree.MethodDeclaration):
            is_test = any(annotation.name == "Test" for annotation in node.annotations)
            nodes.append(("method", node.name, is_test))
    return tuple(nodes)


def test_set_changes(before: dict, after: dict) -> list[str]:
    changes = []
    for path in sorted(set(after) - set(before)):
        changes.append(f"added test file {path}")
    for path in sorted(set(before) - set(after)):
        changes.append(f"removed test file {path}")
    for path in sorted(set(before) & set(after)):
        lhs, rhs = before[path], after[path]
        if lhs == rhs:
            continue
        if lhs is None or rhs is None:
            changes.append(f"{path} no longer parses as Java" if rhs is None else f"{path} did not parse before and does now")
            continue
        names = lambda nodes: {node[1] for node in nodes}
        gone, new = sorted(names(lhs) - names(rhs)), sorted(names(rhs) - names(lhs))
        if gone:
            changes.append(f"{path}: removed or renamed {', '.join(gone)}")
        if new:
            changes.append(f"{path}: added {', '.join(new)}")
        if not gone and not new:
            changes.append(f"{path}: a method lost or gained its @Test annotation, or declarations were reordered")
    return changes


# r4 ------------------------------------------------------------------------

def count_tests(output: str) -> int:
    """Total from Surefire's `[INFO] Results:` block. -2 when Maven never got there, -1 when the block has no total."""
    segments = output.split("[INFO] Results:\n")
    if len(segments) <= 1:
        return -2
    for line in segments[-1].splitlines():
        if line.strip() == "[INFO]":
            continue
        match = re.search(r"^\[INFO\]\s+Tests run:\s+(\d+),", line)
        if match:
            return int(match.group(1))
    return -1


def baseline_tests(root: str, github_url: str, base_commit: str, java8_home: str | None, cache_dir: str | None) -> tuple[int, str]:
    """Tests that run at the base commit, measured once per (repo, commit) and cached."""
    key = hashlib.sha1(f"{github_url}@{base_commit}".encode()).hexdigest()[:16]
    cache = Path(cache_dir) / f"{key}.json" if cache_dir else None
    if cache and cache.is_file():
        data = json.loads(cache.read_text())
        return data["tests"], f"cached {data['source']}"
    for home in (java8_home, os.environ.get("JAVA_HOME")):
        if not home or not os.path.isdir(home):
            continue
        _, output = mvn(["test", "-f", "."], root, java_home=home)
        tests = count_tests(output)
        if tests >= 0:
            if cache:
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(json.dumps({"tests": tests, "source": home}))
            return tests, home
    return -10, "unmeasurable"


# r5 ------------------------------------------------------------------------

def declared_dependencies(root: str) -> set[str]:
    """groupId:artifactId of every <dependency> in every pom.xml."""
    ns = {"m": "http://maven.apache.org/POM/4.0.0"}
    tracked = set()
    for pom in glob.glob(os.path.join(root, "**", "pom.xml"), recursive=True):
        if "/target/" in pom:
            continue
        text = re.sub(r"^\s+", "", Path(pom).read_text(encoding="utf-8", errors="replace"), flags=re.MULTILINE)
        try:
            tree = ET.fromstring(text)
        except ET.ParseError:
            continue
        deps = tree.findall(".//m:dependency", ns) or tree.findall(".//dependency")
        for dep in deps:
            group = dep.find("m:groupId", ns) if dep.find("m:groupId", ns) is not None else dep.find("groupId")
            artifact = dep.find("m:artifactId", ns) if dep.find("m:artifactId", ns) is not None else dep.find("artifactId")
            if group is not None and artifact is not None and group.text and artifact.text:
                tracked.add(f"{group.text.strip()}:{artifact.text.strip()}")
    return tracked


def effective_versions(tree_output: str, tracked: set[str]) -> dict[str, str]:
    """Direct dependencies from `mvn dependency:tree` (the `+-` and `\\-` lines at depth one)."""
    versions = {}
    for line in tree_output.splitlines():
        if not (line.startswith("[INFO] +- ") or line.startswith("[INFO] \\- ")):
            continue
        parts = line.split(" ")[-1].strip().split(":")
        if len(parts) != 5:
            continue
        coordinate = f"{parts[0]}:{parts[1]}"
        if coordinate in tracked:
            versions[coordinate] = parts[3]
    return versions


def major_at_least(have: str, want: str) -> bool:
    try:
        return Version(have).major >= Version(want).major
    except InvalidVersion:
        digits = lambda value: [int(x) for x in re.findall(r"\d+", value)] or [0]
        return digits(have)[0] >= digits(want)[0]


def dependency_misses(root: str) -> tuple[list[dict], int]:
    tracked = declared_dependencies(root)
    code, output = sh(["mvn", "-B", "dependency:tree"], root, dict(os.environ))
    if code != 0:
        return [{"dependency": "dependency:tree failed"}], 0
    have = effective_versions(output, tracked)
    expected = json.loads(DEPENDENCY_VERSIONS.read_text())
    misses = [
        {"dependency": dep, "expected": expected[dep], "got": version}
        for dep, version in have.items()
        if dep in expected and not major_at_least(version, expected[dep])
    ]
    return misses, len(have)


# ---------------------------------------------------------------------------

def grade(github_url: str, base_commit: str, diff_file: str, class_major: int, tests_required: int | None, java8_home: str | None, cache_dir: str | None) -> dict:
    root = tempfile.mkdtemp(prefix="grade-")
    try:
        code, output = sh(["git", "clone", "--quiet", github_url, root], cwd=os.getcwd())
        if code != 0:
            return failed(f"clone failed: {output[-300:]}")
        code, output = sh(["git", "checkout", "--quiet", "--detach", base_commit], root)
        if code != 0:
            return failed(f"checkout {base_commit} failed: {output[-300:]}")

        before = test_files(root)
        if tests_required is None:
            tests_required, baseline_source = baseline_tests(root, github_url, base_commit, java8_home, cache_dir)
            sh(["git", "clean", "-fdxq"], root)
        else:
            baseline_source = "given"

        applied = False
        if os.path.getsize(diff_file) > 0:
            code, output = sh(["git", "apply", os.path.abspath(diff_file)], root)
            if code != 0:
                return failed(f"git apply failed: {output[-300:]}")
            applied = True

        code, verify_output = mvn(["clean", "verify"], root)
        r1 = code == 0
        majors = sorted(class_majors(root)) if r1 else []
        r2 = r1 and majors == [class_major]
        misses, tracked = dependency_misses(root) if r1 else ([], 0)
        r5 = r1 and not misses

        _, test_output = mvn(["test", "-f", "."], root)
        tests = count_tests(test_output)
        r4 = tests_required < 0 or tests >= tests_required

        after = test_files(root)
        changes = test_set_changes(before, after)
        r3 = not changes

        return {
            "r1": r1, "r2": r2, "r3": r3, "r4": r4, "r5": r5,
            "minimal": r1 and r2 and r3 and r4,
            "maximal": r1 and r2 and r3 and r4 and r5,
            "classMajors": majors,
            "tests": tests, "testsRequired": tests_required, "testsBaseline": baseline_source,
            "trackedDependencies": tracked, "dependencyMisses": misses,
            "diffApplied": applied,
            "verifyErrors": [] if r1 else error_lines(verify_output),
            "testSetChanges": changes,
        }
    finally:
        shutil.rmtree(root, ignore_errors=True)


def failed(error: str) -> dict:
    return {
        "r1": False, "r2": False, "r3": False, "r4": False, "r5": False, "minimal": False, "maximal": False,
        "classMajors": [], "tests": None, "testsRequired": -10, "testsBaseline": "none",
        "trackedDependencies": 0, "dependencyMisses": [], "diffApplied": False, "verifyErrors": [], "testSetChanges": [],
        "error": error,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--github-url", required=True)
    parser.add_argument("--base-commit", required=True)
    parser.add_argument("--diff", required=True, help="git diff from the base commit; may be empty")
    parser.add_argument("--class-major", type=int, default=61, help="61 for Java 17, 65 for Java 21")
    parser.add_argument("--tests-required", type=int, default=None, help="r4 baseline; measured at the base commit when omitted")
    parser.add_argument("--java8-home", default=os.environ.get("JAVA8_HOME"), help="JDK used to measure the baseline")
    parser.add_argument("--baseline-cache", default=None, help="directory for measured baselines")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stderr)
    print(json.dumps(grade(args.github_url, args.base_commit, args.diff, args.class_major, args.tests_required, args.java8_home, args.baseline_cache)))


if __name__ == "__main__":
    main()
