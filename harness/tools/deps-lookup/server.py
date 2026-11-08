#!/usr/bin/env python3
"""MCP server over stdio with one tool, lookup_dependency.

Answers with the pinned version for a Maven groupId:artifactId from
versions.json next to this file, or "unknown". Messages are newline-delimited
JSON-RPC, which is what MCP stdio clients send and expect.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

PROTOCOL = "2024-11-05"
VERSIONS_PATH = Path(__file__).resolve().parent / "versions.json"


def load_versions() -> dict[str, str]:
    if not VERSIONS_PATH.is_file():
        return {}
    data = json.loads(VERSIONS_PATH.read_text(encoding="utf-8"))
    return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}


VERSIONS = load_versions()

TOOL = {
    "name": "lookup_dependency",
    "description": "Return the pinned current major version for a Maven groupId and artifactId.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "groupId": {"type": "string"},
            "artifactId": {"type": "string"},
            "coordinate": {"type": "string", "description": "groupId:artifactId, used when the two ids are omitted."},
        },
    },
}


def lookup(arguments: dict[str, Any]) -> str:
    group = str(arguments.get("groupId") or "")
    artifact = str(arguments.get("artifactId") or "")
    coordinate = str(arguments.get("coordinate") or "")
    if coordinate and ":" in coordinate and not (group and artifact):
        group, artifact = coordinate.split(":", 1)
    if not group or not artifact:
        raise ValueError("groupId and artifactId are required")
    return VERSIONS.get(f"{group}:{artifact}", "unknown")


def handle(message: dict[str, Any]) -> dict[str, Any] | None:
    """Return the response for a request, or None for a notification."""
    if "id" not in message:
        return None
    request_id = message["id"]
    method = message.get("method")
    params = message.get("params") or {}
    try:
        if method == "initialize":
            result: Any = {
                "protocolVersion": PROTOCOL,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "deps-lookup", "version": "1.1.0"},
            }
        elif method == "ping":
            result = {}
        elif method == "tools/list":
            result = {"tools": [TOOL]}
        elif method == "tools/call":
            if params.get("name") != "lookup_dependency":
                return error(request_id, -32602, f"Unknown tool: {params.get('name')}")
            result = {"content": [{"type": "text", "text": lookup(params.get("arguments") or {})}], "isError": False}
        else:
            return error(request_id, -32601, f"Method not found: {method}")
    except ValueError as exc:
        return error(request_id, -32602, str(exc))
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        response = handle(message) if isinstance(message, dict) else None
        if response is not None:
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
