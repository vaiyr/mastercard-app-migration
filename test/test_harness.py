"""Tests for the Python pieces copied into every fork: the hook, the pom bump, the lookup server."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "harness" / "cursor" / "hooks"))
sys.path.insert(0, str(ROOT / "harness" / "tools"))

import bump_poms  # noqa: E402
import guard  # noqa: E402

POM = """<project xmlns="http://maven.apache.org/POM/4.0.0">
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>2.2.6.RELEASE</version>
  </parent>
  <properties>
    <java.version>1.8</java.version>
    <lombok.version>${lombok.ver}</lombok.version>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.mockito</groupId>
      <artifactId>mockito-core</artifactId>
      <version>4.5.1</version>
    </dependency>
    <dependency>
      <groupId>org.projectlombok</groupId>
      <artifactId>lombok</artifactId>
      <version>${lombok.version}</version>
    </dependency>
  </dependencies>
</project>
"""

VERSIONS = {
    "org.springframework.boot:spring-boot-starter-parent": "3.3.5",
    "org.mockito:mockito-core": "5.13.0",
    "org.projectlombok:lombok": "1.18.34",
}


class GuardTest(unittest.TestCase):
    def test_denies_skipped_or_deleted_tests(self):
        self.assertEqual(guard.decide({"command": "mvn -DskipTests verify"})["permission"], "deny")
        self.assertEqual(guard.decide({"command": "rm -rf src/test"})["permission"], "deny")
        self.assertEqual(guard.decide({"command": "mvn -B clean verify"})["permission"], "allow")

    def test_denies_version_downgrade(self):
        payload = {"tool_name": "edit", "tool_input": {"old_string": "<version>5.1.0</version>", "new_string": "<version>4.9.0</version>"}}
        self.assertEqual(guard.decide(payload)["permission"], "deny")


class BumpPomsTest(unittest.TestCase):
    def test_raises_pins_and_leaves_properties_alone(self):
        out = bump_poms.rewrite_pom(POM, VERSIONS, "17")
        self.assertIn("<version>3.3.5</version>", out)
        self.assertIn("<version>5.13.0</version>", out)
        self.assertIn("<java.version>17</java.version>", out)
        self.assertIn("<version>${lombok.version}</version>", out)
        self.assertIn("<lombok.version>${lombok.ver}</lombok.version>", out)

    def test_never_lowers_a_version(self):
        out = bump_poms.rewrite_pom(POM, {"org.mockito:mockito-core": "3.0.0"}, "17")
        self.assertIn("<version>4.5.1</version>", out)

    def test_is_idempotent(self):
        once = bump_poms.rewrite_pom(POM, VERSIONS, "17")
        self.assertEqual(once, bump_poms.rewrite_pom(once, VERSIONS, "17"))


class LookupServerTest(unittest.TestCase):
    def test_answers_tools_call(self):
        with tempfile.TemporaryDirectory() as tmp:
            server_dir = Path(tmp) / "deps-lookup"
            server_dir.mkdir()
            (server_dir / "server.py").write_text((ROOT / "harness/tools/deps-lookup/server.py").read_text())
            (server_dir / "versions.json").write_text(json.dumps(VERSIONS))
            requests = [
                {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
                {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "lookup_dependency", "arguments": {"coordinate": "org.mockito:mockito-core"}}},
            ]
            stdin = "".join(json.dumps(r) + "\n" for r in requests)
            proc = subprocess.run([sys.executable, str(server_dir / "server.py")], input=stdin.encode(), capture_output=True, timeout=20)
            self.assertIn(b"5.13.0", proc.stdout)


if __name__ == "__main__":
    unittest.main()
