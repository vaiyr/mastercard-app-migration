# Pinned agent image: Temurin 8, Temurin 17, Maven 3.9.6.
# Cursor checks the repository out itself. Do not COPY the project.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    JAVA_HOME=/opt/java/temurin-17 \
    MAVEN_HOME=/opt/maven

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      tar \
      gzip \
      git \
      python3 \
      sudo \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system --add safe.directory '*' \
    && git config --system user.email "harness@example.com" \
    && git config --system user.name "Migration Harness"

RUN mkdir -p /opt/java/temurin-8 /opt/java/temurin-17 /var/maven/repository \
    && curl -fsSL -o /tmp/jdk8.tar.gz \
      https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u432-b06/OpenJDK8U-jdk_x64_linux_hotspot_8u432b06.tar.gz \
    && curl -fsSL -o /tmp/jdk17.tar.gz \
      https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jdk_x64_linux_hotspot_17.0.13_11.tar.gz \
    && curl -fsSL -o /tmp/maven.tar.gz \
      https://archive.apache.org/dist/maven/maven-3/3.9.6/binaries/apache-maven-3.9.6-bin.tar.gz \
    && tar -xzf /tmp/jdk8.tar.gz -C /opt/java/temurin-8 --strip-components=1 \
    && tar -xzf /tmp/jdk17.tar.gz -C /opt/java/temurin-17 --strip-components=1 \
    && tar -xzf /tmp/maven.tar.gz -C /opt \
    && ln -sfn /opt/apache-maven-3.9.6 /opt/maven \
    && rm -f /tmp/jdk8.tar.gz /tmp/jdk17.tar.gz /tmp/maven.tar.gz \
    && chmod -R a+rX /opt/java /opt/maven /var/maven \
    && chmod 777 /var/maven /var/maven/repository

COPY settings.xml /opt/maven/conf/settings.xml

ENV PATH="/opt/maven/bin:/opt/java/temurin-17/bin:${PATH}"

RUN id -u ubuntu >/dev/null 2>&1 || useradd -m -s /bin/bash ubuntu \
    && mkdir -p /etc/sudoers.d \
    && echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu \
    && chmod 440 /etc/sudoers.d/ubuntu

RUN JAVA_HOME=/opt/java/temurin-8 mvn -v \
    && JAVA_HOME=/opt/java/temurin-17 mvn -v
