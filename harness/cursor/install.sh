#!/usr/bin/env bash
# Idempotent Build install. Dependency warming is best-effort.
# A missing JDK or Maven fails the Build. A failing resolve does not.
set -euo pipefail

export PATH="/opt/maven/bin:${PATH}"

check_jdk() {
  local home="$1"
  echo "=== JAVA_HOME=${home} ==="
  JAVA_HOME="${home}" mvn -v
}

check_jdk /opt/java/temurin-8
check_jdk /opt/java/temurin-17

if [[ -f pom.xml ]]; then
  JAVA_HOME=/opt/java/temurin-8 mvn -B dependency:resolve >/tmp/m2-warm-8.log 2>&1 || true
  JAVA_HOME=/opt/java/temurin-17 mvn -B dependency:resolve >/tmp/m2-warm-17.log 2>&1 || true
fi

setup=""
if [[ -f .cursor/harness-setup ]]; then
  setup="$(tr -d '[:space:]' < .cursor/harness-setup)"
fi

if [[ "${setup}" == "h2" ]]; then
  python3 tools/deps-prepass.py
fi
