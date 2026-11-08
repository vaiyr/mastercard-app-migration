import path from "node:path";

/** Read .env from the working directory when it exists. Existing variables win. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile(path.resolve(".env"));
  } catch {
    return;
  }
}

export function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env (see .env.example)`);
  return value;
}

/** Environment for local Maven and the grader: Java 17 and Maven 3.9.6 first on PATH. */
export function javaEnv(): NodeJS.ProcessEnv {
  const java = need("JAVA17_HOME");
  const maven = need("MAVEN_HOME");
  return {
    ...process.env,
    JAVA_HOME: java,
    PATH: `${java}/bin:${maven}/bin:${process.env.PATH ?? ""}`,
  };
}

export function scrub(text: string, secret: string | undefined): string {
  return secret ? text.split(secret).join("[REDACTED]") : text;
}
