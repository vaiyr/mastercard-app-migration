#!/usr/bin/env python3
"""Project hook: log shell commands and block test deletion, skipped tests, and downgrades."""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


def _nums(value: str) -> list[int]:
    return [int(part) for part in re.findall(r"\d+", value)]


def version_cmp(left: str, right: str) -> int:
    """Compare dotted versions. Qualifiers are ignored. Missing parts are zero."""
    a = _nums(left)
    b = _nums(right)
    width = max(len(a), len(b), 1)
    a.extend([0] * (width - len(a)))
    b.extend([0] * (width - len(b)))
    if a < b:
        return -1
    if a > b:
        return 1
    return 0


def _version_groups(text: str) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = defaultdict(list)
    for tag, value in re.findall(
        r"<([^>\s/]*version[^>\s/]*)>([^<]+)</", text, flags=re.IGNORECASE
    ):
        groups[tag.lower()].append(value.strip())
    return groups


def downgrades(old: str, new: str) -> bool:
    """True when a same-named version tag is replaced by an older value."""
    before = _version_groups(old)
    after = _version_groups(new)
    for tag, old_values in before.items():
        new_values = after.get(tag)
        if not new_values:
            continue
        for old_value, new_value in zip(old_values, new_values):
            if version_cmp(new_value, old_value) < 0:
                return True
    return False


def _command_text(payload: dict[str, Any]) -> str:
    command = payload.get("command")
    if isinstance(command, str):
        return command
    tool_input = payload.get("tool_input")
    if isinstance(tool_input, dict):
        for key in ("command", "cmd"):
            value = tool_input.get(key)
            if isinstance(value, str):
                return value
    if isinstance(tool_input, str):
        return tool_input
    return ""


def _paths(payload: dict[str, Any]) -> list[str]:
    found: list[str] = []
    tool_input = payload.get("tool_input")
    if isinstance(tool_input, dict):
        for key in ("path", "file_path", "target_file", "target_notebook"):
            value = tool_input.get(key)
            if isinstance(value, str):
                found.append(value)
    for key in ("path", "file_path"):
        value = payload.get(key)
        if isinstance(value, str):
            found.append(value)
    return found


def _is_test_path(path: str) -> bool:
    normalized = path.replace("\\", "/")
    return "/src/test/" in f"/{normalized}" or normalized.startswith("src/test/")


def _skips_tests(command: str) -> bool:
    if re.search(r"-DskipTests(?!\s*=\s*false\b)", command, flags=re.IGNORECASE):
        return True
    if re.search(r"-Dmaven\.test\.skip(?!\s*=\s*false\b)", command, flags=re.IGNORECASE):
        return True
    return False


def _deletes_tests(command: str) -> bool:
    if not re.search(r"\bsrc/test\b", command):
        return False
    return re.search(r"\b(rm|unlink|git\s+rm|git\s+clean|find)\b", command) is not None


def _tool_name(payload: dict[str, Any]) -> str:
    name = payload.get("tool_name") or payload.get("tool") or ""
    return str(name)


def decide(payload: dict[str, Any]) -> dict[str, str]:
    """Return a hook permission response. Unknown events are allowed."""
    command = _command_text(payload)
    tool = _tool_name(payload).lower()
    paths = _paths(payload)

    if command and (_skips_tests(command) or _deletes_tests(command)):
        return {
            "permission": "deny",
            "agent_message": "Blocked: tests cannot be skipped or deleted.",
            "user_message": "Blocked a command that skips or deletes tests.",
        }

    deletes_test_file = tool in {"delete", "delete_file"} and any(
        _is_test_path(path) for path in paths
    )
    if deletes_test_file:
        return {
            "permission": "deny",
            "agent_message": "Blocked: files under src/test cannot be deleted.",
            "user_message": "Blocked a delete under src/test.",
        }

    tool_input = payload.get("tool_input")
    if isinstance(tool_input, dict):
        old = tool_input.get("old_string") or tool_input.get("old_str") or ""
        new = tool_input.get("new_string") or tool_input.get("new_str") or ""
        if isinstance(old, str) and isinstance(new, str) and old and new and downgrades(old, new):
            return {
                "permission": "deny",
                "agent_message": "Blocked: a dependency or plugin version would be downgraded.",
                "user_message": "Blocked a version downgrade.",
            }
        contents = tool_input.get("contents") or tool_input.get("content")
        target = next((path for path in paths if path.endswith("pom.xml")), "")
        if isinstance(contents, str) and target:
            existing = _read_if_present(target)
            if existing and downgrades(existing, contents):
                return {
                    "permission": "deny",
                    "agent_message": "Blocked: the replacement pom.xml downgrades a version.",
                    "user_message": "Blocked a pom.xml version downgrade.",
                }

    return {"permission": "allow"}


def _read_if_present(path: str) -> str:
    file_path = Path(path)
    if not file_path.is_file():
        return ""
    try:
        return file_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _log_shell(payload: dict[str, Any]) -> None:
    command = payload.get("command")
    if not isinstance(command, str):
        return
    log_path = Path(".cursor/hooks/shell.log")
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(command.replace("\n", " ") + "\n")
    except OSError:
        return


def main() -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    _log_shell(payload)
    json.dump(decide(payload), sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
