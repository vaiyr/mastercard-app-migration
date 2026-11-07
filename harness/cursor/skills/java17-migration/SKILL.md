---
name: java17-migration
description: Migrate a single-module Maven project from Java 8 to the target JDK, including Spring Boot 2 to 3 and javax to jakarta. Use when harness-setup is h1 or h2.
---

# Java 17 migration

Work in this order. After each edit, compile. Do not skip tests.

1. Read `pom.xml`, `.cursor/harness-target`, and the current `java.version` or compiler source/target.
2. For every version you intend to change, call `lookup_dependency` when that tool is available. Use the returned version. If it returns `unknown`, keep the current version unless a step below names a floor.
3. Move the compiler to the target release: `java.version`, `maven.compiler.release`, source, and target. Remove boot classpath flags that exist only for Java 8.
4. If the parent is `spring-boot-starter-parent` 2.x, set it to the lookup result for that coordinate (Boot 3).
5. Replace Java EE imports and dependencies:
   - `javax.servlet` -> `jakarta.servlet`
   - `javax.persistence` -> `jakarta.persistence`
   - `javax.validation` -> `jakarta.validation`
   - `javax.annotation` -> `jakarta.annotation`
   - `javax.inject` -> `jakarta.inject`
   - `javax.transaction` -> `jakarta.transaction`
   - `javax.xml.bind` -> `jakarta.xml.bind`
   - `javax.ws.rs` -> `jakarta.ws.rs`
   Artifact ids that still say `javax` usually need the matching `jakarta` artifact. Do not leave a compile-only Java 8 API on the classpath.
6. Spring Security 6 removes `WebSecurityConfigurerAdapter`. Replace it with a `SecurityFilterChain` bean. `antMatchers` becomes `requestMatchers`.
7. OpenAPI Generator: set configuration option `useJakartaEe` to `true`. Regenerate sources if the module already generates them, and commit the generator config change.
8. Floors when lookup has no row:
   - Lombok `1.18.30` or newer (annotation processing must stay on)
   - JaCoCo `0.8.8` or newer
   - Surefire `3.0.0` or newer when the module runs JUnit 5
9. OkHttp 3.x declarations move to OkHttp 4 (`com.squareup.okhttp3:okhttp` at the lookup version, otherwise `4.12.0`). Prefer `RequestBody.create(String, MediaType)` over `RequestBody.create(MediaType, String)`.
10. JUnit 4 tests may stay. Adding JUnit 5 imports is allowed. `junit-vintage-engine` may stay so existing `@Test` methods still run. Do not rename a test method, do not delete one, and do not change its assertions just to make a count match.
11. Verify with `JAVA_HOME=/opt/java/temurin-17 mvn -B clean verify`.

Fix the first compiler error before starting a second rewrite. If verify fails, quote the error and patch that cause.
