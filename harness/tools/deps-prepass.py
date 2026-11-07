#!/usr/bin/env python3
"""Rewrite pom.xml files to pinned versions when the pin is newer. Idempotent."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

JAVA_PROPERTIES = (
    "java.version",
    "maven.compiler.source",
    "maven.compiler.target",
    "maven.compiler.release",
    "java.source",
    "java.target",
)


def version_key(value: str) -> list[int]:
    return [int(part) for part in re.findall(r"\d+", value)]


def is_newer(candidate: str, current: str) -> bool:
    if current.strip().startswith("${"):
        return False
    left = version_key(candidate)
    right = version_key(current)
    width = max(len(left), len(right), 1)
    left.extend([0] * (width - len(left)))
    right.extend([0] * (width - len(right)))
    return left > right


def java_major(value: str) -> int | None:
    parts = version_key(value)
    if not parts:
        return None
    if parts[0] == 1 and len(parts) > 1:
        return parts[1]
    return parts[0]


def _replace_version_in_block(block: str, versions: dict[str, str]) -> str:
    group = re.search(r"<groupId>\s*([^<]+?)\s*</groupId>", block)
    artifact = re.search(r"<artifactId>\s*([^<]+?)\s*</artifactId>", block)
    version = re.search(r"<version>\s*([^<]+?)\s*</version>", block)
    if not (group and artifact and version):
        return block
    coordinate = f"{group.group(1)}:{artifact.group(1)}"
    pinned = versions.get(coordinate)
    current = version.group(1).strip()
    if not pinned or not is_newer(pinned, current):
        return block
    return (
        block[: version.start(1)]
        + pinned
        + block[version.end(1) :]
    )


def rewrite_pom(text: str, versions: dict[str, str], java_target: str) -> str:
    target_major = int(java_target)

    def bump_property(match: re.Match[str]) -> str:
        name = match.group(1).strip()
        current = match.group(2).strip()
        if name not in JAVA_PROPERTIES:
            return match.group(0)
        major = java_major(current)
        if major is None or major >= target_major:
            return match.group(0)
        return f"<{match.group(1)}>{java_target}</{match.group(3)}>"

    text = re.sub(
        r"<([\w.-]*version[\w.-]*|java\.version|maven\.compiler\.(?:source|target|release)|java\.(?:source|target))>\s*([^<]+?)\s*</([\w.-]+)>",
        bump_property,
        text,
    )

    def bump_block(match: re.Match[str]) -> str:
        return _replace_version_in_block(match.group(0), versions)

    text = re.sub(r"<parent\b[^>]*>.*?</parent>", bump_block, text, flags=re.DOTALL)
    text = re.sub(r"<dependency\b[^>]*>.*?</dependency>", bump_block, text, flags=re.DOTALL)
    text = re.sub(r"<plugin\b[^>]*>.*?</plugin>", bump_block, text, flags=re.DOTALL)
    return text


def load_versions(root: Path) -> dict[str, str]:
    path = root / "tools" / "deps-lookup" / "versions.json"
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return {}
    return {str(key): str(value) for key, value in data.items()}


def java_target_for(root: Path) -> str:
    path = root / ".cursor" / "harness-target"
    if not path.is_file():
        return "17"
    value = path.read_text(encoding="utf-8").strip() or "17"
    if not re.fullmatch(r"\d+", value):
        return "17"
    return value


def rewrite_tree(root: Path) -> list[Path]:
    versions = load_versions(root)
    target = java_target_for(root)
    changed: list[Path] = []
    for pom in sorted(root.rglob("pom.xml")):
        if any(part in {".git", "target"} for part in pom.parts):
            continue
        original = pom.read_text(encoding="utf-8")
        updated = rewrite_pom(original, versions, target)
        if updated != original:
            pom.write_text(updated, encoding="utf-8")
            changed.append(pom)
    return changed


def main() -> None:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    changed = rewrite_tree(root)
    for path in changed:
        print(path)


if __name__ == "__main__":
    main()
