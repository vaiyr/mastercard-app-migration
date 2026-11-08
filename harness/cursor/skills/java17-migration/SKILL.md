---
name: java17-migration
description: Migrate a single-module Maven project from Java 8 to Java 17, including Spring Boot 2 to 3 and javax to jakarta.
---

# Java 17 migration

Work in this order. Compile after each step. Do not skip tests.

1. Read `pom.xml` and `.cursor/harness-target`. Note the current `java.version` or compiler source and target.
2. For every version you plan to change, call `lookup_dependency` if the tool is present and use what it returns. If it returns `unknown`, keep the current version unless a step below sets a floor.
3. Set the compiler to the target release: `java.version`, `maven.compiler.release`, source, and target. Remove boot classpath flags that only exist for Java 8.
4. If the parent is `spring-boot-starter-parent` 2.x, move it to the Boot 3 version from the lookup.
5. Replace Java EE imports and artifacts:
   - `javax.servlet` -> `jakarta.servlet`
   - `javax.persistence` -> `jakarta.persistence`
   - `javax.validation` -> `jakarta.validation`
   - `javax.annotation` -> `jakarta.annotation`
   - `javax.inject` -> `jakarta.inject`
   - `javax.transaction` -> `jakarta.transaction`
   - `javax.xml.bind` -> `jakarta.xml.bind`
   - `javax.ws.rs` -> `jakarta.ws.rs`
   An artifact id that still says `javax` usually needs its `jakarta` counterpart. Do not leave a compile-only Java 8 API on the classpath.
6. Spring Security 6 removes `WebSecurityConfigurerAdapter`. Replace it with a `SecurityFilterChain` bean. `antMatchers` becomes `requestMatchers`.
7. OpenAPI Generator: set `useJakartaEe` to `true`. If the module generates sources, regenerate them and commit the generator config change.
8. Floors when the lookup has no row: Lombok `1.18.30`, JaCoCo `0.8.8`, Surefire `3.0.0` when the module runs JUnit 5.
9. OkHttp 3.x moves to OkHttp 4 (`com.squareup.okhttp3:okhttp`, lookup version or `4.12.0`). Prefer `RequestBody.create(String, MediaType)`.
10. JUnit 4 tests may stay; `junit-vintage-engine` may stay so they still run. Do not rename, delete, or weaken a test to make a count match.
11. Verify with `JAVA_HOME=/opt/java/temurin-17 mvn -B clean verify`.

Fix the first compiler error before starting another rewrite. When verify fails, quote the error and patch that cause.
