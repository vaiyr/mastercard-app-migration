#!/usr/bin/env bash
# One-time setup: Node packages, the grader's Python environment, and the grader toolchain
# (Temurin 17, Zulu 8, Maven 3.9.6) under a prefix. Writes the toolchain paths into .env.
# Safe to run again; anything already present is kept.
#
#   bash scripts/setup.sh            # installs under ~/opt
#   PREFIX=/some/dir bash scripts/setup.sh
set -euo pipefail

PREFIX="${PREFIX:-$HOME/opt}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) JDK17_URL="https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.13_11.tar.gz"
                JDK8_URL="https://cdn.azul.com/zulu/bin/zulu8.82.0.21-ca-jdk8.0.432-macosx_aarch64.tar.gz" ;;
  Darwin-x86_64) JDK17_URL="https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jdk_x64_mac_hotspot_17.0.13_11.tar.gz"
                 JDK8_URL="https://cdn.azul.com/zulu/bin/zulu8.82.0.21-ca-jdk8.0.432-macosx_x64.tar.gz" ;;
  Linux-x86_64) JDK17_URL="https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jdk_x64_linux_hotspot_17.0.13_11.tar.gz"
                JDK8_URL="https://cdn.azul.com/zulu/bin/zulu8.82.0.21-ca-jdk8.0.432-linux_x64.tar.gz" ;;
  Linux-aarch64) JDK17_URL="https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jdk_aarch64_linux_hotspot_17.0.13_11.tar.gz"
                 JDK8_URL="https://cdn.azul.com/zulu/bin/zulu8.82.0.21-ca-jdk8.0.432-linux_aarch64.tar.gz" ;;
  *) echo "unsupported platform $(uname -s)-$(uname -m)"; exit 1 ;;
esac
MAVEN_URL="https://archive.apache.org/dist/maven/maven-3/3.9.6/binaries/apache-maven-3.9.6-bin.tar.gz"

# Unpack a JDK tarball so that $dest/bin/java exists on both macOS (Contents/Home) and Linux layouts.
install_jdk() {
  local url="$1" dest="$2" tmp
  if [[ -x "$dest/bin/java" ]]; then echo "have $dest"; return; fi
  tmp="$(mktemp -d)"
  echo "fetching $(basename "$url")"
  curl -fsSL "$url" | tar -xz -C "$tmp"
  local home
  home="$(find "$tmp" -type d -path '*/Contents/Home' | head -1)"
  [[ -n "$home" ]] || home="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -1)"
  mkdir -p "$(dirname "$dest")"
  mv "$home" "$dest"
  rm -rf "$tmp"
  echo "installed $dest"
}

install_jdk "$JDK17_URL" "$PREFIX/java/temurin-17"
install_jdk "$JDK8_URL" "$PREFIX/java/jdk-8"

if [[ -x "$PREFIX/maven/bin/mvn" ]]; then
  echo "have $PREFIX/maven"
else
  echo "fetching apache-maven-3.9.6"
  mkdir -p "$PREFIX"
  curl -fsSL "$MAVEN_URL" | tar -xz -C "$PREFIX"
  ln -sfn "$PREFIX/apache-maven-3.9.6" "$PREFIX/maven"
  echo "installed $PREFIX/maven"
fi

echo "node packages"
npm install --silent
echo "grader python"
[[ -d .venv ]] || python3 -m venv .venv
.venv/bin/pip install -q -r grader/requirements.txt

# .env: start from the example, then fill in the toolchain paths we just installed.
[[ -f .env ]] || cp .env.example .env
set_var() {
  local key="$1" value="$2"
  if grep -q "^$key=" .env; then
    sed -i.bak "s|^$key=.*|$key=$value|" .env && rm -f .env.bak
  else
    echo "$key=$value" >> .env
  fi
}
set_var JAVA17_HOME "$PREFIX/java/temurin-17"
set_var JAVA8_HOME "$PREFIX/java/jdk-8"
set_var MAVEN_HOME "$PREFIX/maven"

JAVA_HOME="$PREFIX/java/temurin-17" "$PREFIX/maven/bin/mvn" -v | head -3
echo
echo "Toolchain paths are in .env. Fill in CURSOR_API_KEY, CURSOR_ADMIN_API_KEY, GITHUB_TOKEN and FORK_OWNER there, then run: npm test"
