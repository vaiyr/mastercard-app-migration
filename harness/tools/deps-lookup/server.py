#!/usr/bin/env python3
"""Stdio MCP server: pinned Maven coordinates from versions.json."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

PROTOCOL = "2024-11-05"
ROOT = Path(__file__).resolve().parent
VERSIONS_PATH = ROOT / "versions.json"


def load_versions() -> dict[str, str]:
    if not VERSIONS_PATH.is_file():
        return {}
    data = json.loads(VERSIONS_PATH.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return {}
    return {str(key): str(value) for key, value in data.items()}


VERSIONS = load_versions()


def lookup(group_id: str, artifact_id: str) -> str:
    coordinate = f"{group_id}:{artifact_id}"
    return VERSIONS.get(coordinate, "unknown")


def _tool_result(text: str) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": text}],
        "isError": False,
    }


def handle(message: dict[str, Any]) -> dict[str, Any] | None:
    if "id" not in message:
        return None
    method = message.get("method")
    request_id = message.get("id")
    params = message.get("params") or {}
    if method == "initialize":
        result = {
            "protocolVersion": PROTOCOL,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "deps-lookup", "version": "1.0.0"},
        }
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {
            "tools": [
                {
                    "name": "lookup_dependency",
                    "description": "Return the pinned current major version for a Maven groupId and artifactId.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "groupId": {"type": "string"},
                            "artifactId": {"type": "string"},
                            "coordinate": {
                                "type": "string",
                                "description": "groupId:artifactId. Used when groupId and artifactId are omitted.",
                            },
                        },
                    },
                }
            ]
        }
    elif method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if name != "lookup_dependency":
            return _error(request_id, -32602, f"Unknown tool: {name}")
        coordinate = str(arguments.get("coordinate") or "")
        group_id = str(arguments.get("groupId") or "")
        artifact_id = str(arguments.get("artifactId") or "")
        if coordinate and ":" in coordinate and not (group_id and artifact_id):
            group_id, artifact_id = coordinate.split(":", 1)
        if not group_id or not artifact_id:
            return _error(request_id, -32602, "groupId and artifactId are required")
        result = _tool_result(lookup(group_id, artifact_id))
    else:
        return _error(request_id, -32601, f"Method not found: {method}")
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": code, "message": message},
    }


def _read_message() -> dict[str, Any] | None:
    header = b""
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        if line in (b"\r\n", b"\n"):
            break
        header += line
    if not header:
        return None
    if header.lstrip().startswith(b"{"):
        payload = header
        extra = sys.stdin.buffer.readline()
        if extra and extra.strip():
            payload = header + extra
        return json.loads(payload.decode("utf-8"))
    length = 0
    for raw in header.decode("utf-8", errors="replace").splitlines():
        if raw.lower().startswith("content-length:"):
            length = int(raw.split(":", 1)[1].strip())
    if length <= 0:
        return None
    body = sys.stdin.buffer.read(length)
    return json.loads(body.decode("utf-8"))


def _write_message(payload: dict[str, Any]) -> None:
    body = json.dumps(payload).encode("utf-8")
    sys.stdout.buffer.write(f"Content-Length: {len(body)}\r\n\r\n".encode("ascii"))
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()


def main() -> None:
    while True:
        try:
            message = _read_message()
        except json.JSONDecodeError:
            continue
        if message is None:
            return
        response = handle(message)
        if response is not None:
            _write_message(response)


if __name__ == "__main__":
    main()
