import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name: str, file: Path):
    spec = importlib.util.spec_from_file_location(name, file)
    if spec is None or spec.loader is None:
        raise RuntimeError(file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


guard = load("guard", ROOT / "harness" / "cursor" / "hooks" / "guard.py")
deps_prepass = load("deps_prepass", ROOT / "harness" / "tools" / "deps-prepass.py")
server = load("lookup_server", ROOT / "harness" / "tools" / "deps-lookup" / "server.py")


class GuardTest(unittest.TestCase):
    def test_denies_skipped_tests_and_deletes(self):
        self.assertEqual(guard.decide({"command": "mvn -DskipTests test"})["permission"], "deny")
        self.assertEqual(guard.decide({"command": "mvn -DskipTests=false test"})["permission"], "allow")
        self.assertEqual(guard.decide({"command": "rm -rf src/test/java/AppTest.java"})["permission"], "deny")

    def test_denies_version_downgrade(self):
        old = "<version>3.3.4</version>"
        new = "<version>2.7.18</version>"
        decision = guard.decide({"tool_input": {"old_string": old, "new_string": new}})
        self.assertEqual(decision["permission"], "deny")
        upgrade = guard.decide(
            {"tool_input": {"old_string": new, "new_string": old}}
        )
        self.assertEqual(upgrade["permission"], "allow")


class PrepassTest(unittest.TestCase):
    def test_upgrades_parent_and_java_without_downgrade(self):
        pom = """<project>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>2.2.6.RELEASE</version>
  </parent>
  <properties><java.version>1.8</java.version></properties>
  <dependencies>
    <dependency>
      <groupId>com.squareup.okhttp3</groupId>
      <artifactId>okhttp</artifactId>
      <version>3.14.9</version>
    </dependency>
    <dependency>
      <groupId>org.projectlombok</groupId>
      <artifactId>lombok</artifactId>
      <version>1.18.34</version>
    </dependency>
  </dependencies>
</project>
"""
        versions = {
            "org.springframework.boot:spring-boot-starter-parent": "3.3.4",
            "com.squareup.okhttp3:okhttp": "4.12.0",
            "org.projectlombok:lombok": "1.18.30",
        }
        updated = deps_prepass.rewrite_pom(pom, versions, "17")
        self.assertIn("<version>3.3.4</version>", updated)
        self.assertIn("<java.version>17</java.version>", updated)
        self.assertIn("<version>4.12.0</version>", updated)
        self.assertIn("<version>1.18.34</version>", updated)
        self.assertEqual(deps_prepass.rewrite_pom(updated, versions, "17"), updated)

    def test_rewrites_a_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "tools" / "deps-lookup").mkdir(parents=True)
            (root / ".cursor").mkdir()
            (root / ".cursor" / "harness-target").write_text("17\n", encoding="utf-8")
            (root / "tools" / "deps-lookup" / "versions.json").write_text(
                json.dumps({"org.example:lib": "2.0.0"}), encoding="utf-8"
            )
            (root / "pom.xml").write_text(
                "<project><dependencies><dependency><groupId>org.example</groupId><artifactId>lib</artifactId><version>1.0.0</version></dependency></dependencies></project>",
                encoding="utf-8",
            )
            changed = deps_prepass.rewrite_tree(root)
            self.assertEqual(len(changed), 1)
            self.assertIn("2.0.0", (root / "pom.xml").read_text(encoding="utf-8"))


class LookupTest(unittest.TestCase):
    def test_lookup_and_initialize(self):
        server.VERSIONS = {"org.example:lib": "2.0.0"}
        self.assertEqual(server.lookup("org.example", "lib"), "2.0.0")
        self.assertEqual(server.lookup("org.example", "missing"), "unknown")
        response = server.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize"})
        self.assertEqual(response["result"]["serverInfo"]["name"], "deps-lookup")
        call = server.handle(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "lookup_dependency", "arguments": {"coordinate": "org.example:lib"}},
            }
        )
        self.assertEqual(call["result"]["content"][0]["text"], "2.0.0")
        self.assertIsNone(server.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}))


class HookProcessTest(unittest.TestCase):
    def test_cli_prints_json(self):
        script = ROOT / "harness" / "cursor" / "hooks" / "guard.py"
        completed = subprocess.run(
            [sys.executable, str(script)],
            input=json.dumps({"command": "mvn test"}),
            text=True,
            capture_output=True,
            check=True,
        )
        self.assertEqual(json.loads(completed.stdout)["permission"], "allow")


if __name__ == "__main__":
    unittest.main()
