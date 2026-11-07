#!/usr/bin/env bash
# Install pinned Temurin 8 (1.8.0_432), Temurin 17 (17.0.13), and Maven 3.9.6
# when the cloud VM did not boot the Dockerfile image. Idempotent.
set -euo pipefail

if [[ "$(id -u)" -ne 0 && ( ! -w /opt || ! -w /var ) ]]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "sudo is missing and /opt is not writable" >&2
    exit 1
  fi
  exec sudo -n -E bash "$0" "$@"
fi

need_pkgs=()
command -v curl >/dev/null 2>&1 || need_pkgs+=(curl)
command -v tar >/dev/null 2>&1 || need_pkgs+=(tar)
if [[ ${#need_pkgs[@]} -gt 0 ]]; then
  apt-get update
  apt-get install -y --no-install-recommends "${need_pkgs[@]}" ca-certificates
fi

install_tree() {
  local url="$1"
  local dest="$2"
  local tmp
  tmp="$(mktemp)"
  curl -fsSL -o "$tmp" "$url"
  mkdir -p "$dest"
  tar -xzf "$tmp" -C "$dest" --strip-components=1
  rm -f "$tmp"
}

if [[ ! -x /opt/java/temurin-8/bin/java ]]; then
  install_tree \
    "https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u432-b06/OpenJDK8U-jdk_x64_linux_hotspot_8u432b06.tar.gz" \
    /opt/java/temurin-8
fi

if [[ ! -x /opt/java/temurin-17/bin/java ]]; then
  install_tree \
    "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jdk_x64_linux_hotspot_17.0.13_11.tar.gz" \
    /opt/java/temurin-17
fi

if [[ ! -x /opt/maven/bin/mvn ]]; then
  tmp="$(mktemp)"
  curl -fsSL -o "$tmp" \
    "https://archive.apache.org/dist/maven/maven-3/3.9.6/binaries/apache-maven-3.9.6-bin.tar.gz"
  tar -xzf "$tmp" -C /opt
  ln -sfn /opt/apache-maven-3.9.6 /opt/maven
  rm -f "$tmp"
fi

mkdir -p /var/maven/repository /usr/local/bin
chmod -R a+rX /opt/java /opt/maven || true
chmod 777 /var/maven /var/maven/repository || true

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${script_dir}/settings.xml" ]]; then
  cp "${script_dir}/settings.xml" /opt/maven/conf/settings.xml
fi

ln -sfn /opt/maven/bin/mvn /usr/local/bin/mvn

java8_version="$(/opt/java/temurin-8/bin/java -version 2>&1 || true)"
java17_version="$(/opt/java/temurin-17/bin/java -version 2>&1 || true)"
printf '%s\n' "$java8_version" | grep -q '1.8.0_432'
printf '%s\n' "$java17_version" | grep -q '17.0.13'
JAVA_HOME=/opt/java/temurin-17 /opt/maven/bin/mvn -v | grep -q 'Apache Maven 3.9.6'
