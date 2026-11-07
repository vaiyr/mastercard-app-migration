/** Dockerfile image selection. Uses CURSOR_ADMIN_API_KEY as a Bearer token. */

const API = "https://api.cursor.com";

export const DOCKERFILE_ENVIRONMENT = {
  build: { dockerfile: "Dockerfile" },
  install: "bash .cursor/install.sh",
};

export function repoSlug(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/\/$/, "");
}

export function needsDockerfileBuild(active: { type?: string } | undefined): boolean {
  return active?.type !== "build";
}

interface EnvironmentItem {
  id?: string;
  name?: string;
  repos?: Array<{ url?: string }>;
}

function adminKey(): string {
  const key = process.env.CURSOR_ADMIN_API_KEY;
  if (!key) throw new Error("CURSOR_ADMIN_API_KEY is not set");
  return key;
}

function scrub(text: string, key: string): string {
  return text.split(key).join("[REDACTED]");
}

async function request(
  method: string,
  path: string,
  payload?: unknown,
): Promise<{ status: number; body: unknown; text: string }> {
  const key = adminKey();
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = text;
  }
  return { status: response.status, body, text: scrub(text, key) };
}

async function listEnvironments(slug: string): Promise<EnvironmentItem[]> {
  const items: EnvironmentItem[] = [];
  let cursor = "";
  for (;;) {
    const query = new URLSearchParams({ repo: slug, limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const response = await request("GET", `/v1/environments?${query.toString()}`);
    if (response.status !== 200 || !response.body || typeof response.body !== "object") {
      throw new Error(`GET /v1/environments returned ${response.status}`);
    }
    const page = response.body as { items?: EnvironmentItem[]; nextCursor?: string };
    items.push(...(page.items ?? []));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

async function createEnvironment(forkUrl: string, slug: string): Promise<EnvironmentItem> {
  const name = `harness-${slug.split("/").pop() ?? "repo"}`.slice(0, 80);
  const payload = {
    owner: "team",
    name,
    repos: [{ url: forkUrl }],
    environmentJson: JSON.stringify(DOCKERFILE_ENVIRONMENT),
  };
  const created = await request("POST", "/v1/environments", payload);
  if (created.status === 201 && created.body && typeof created.body === "object") {
    return created.body as EnvironmentItem;
  }
  if (created.status === 409 && created.body && typeof created.body === "object") {
    const existing = created.body as { environmentId?: string };
    if (existing.environmentId) return { id: existing.environmentId, name };
  }
  throw new Error(`POST /v1/environments returned ${created.status}: ${created.text.slice(0, 180)}`);
}

async function activeBuild(environmentId: string): Promise<{ type?: string; buildId?: string }> {
  const response = await request("GET", `/v1/environments/${environmentId}/builds/active`);
  if (response.status !== 200 || !response.body || typeof response.body !== "object") {
    throw new Error(`GET active build returned ${response.status}`);
  }
  return response.body as { type?: string; buildId?: string };
}

async function startBuild(environmentId: string): Promise<string> {
  const response = await request("POST", `/v1/environments/${environmentId}/builds`, {});
  if (response.status !== 202 || !response.body || typeof response.body !== "object") {
    throw new Error(`POST build returned ${response.status}: ${response.text.slice(0, 180)}`);
  }
  const body = response.body as { id?: string };
  if (!body.id) throw new Error("POST build returned no id");
  return body.id;
}

async function buildStatus(environmentId: string, buildId: string): Promise<string> {
  const response = await request("GET", `/v1/environments/${environmentId}/builds/${buildId}`);
  if (!response.body || typeof response.body !== "object") return "UNKNOWN";
  return String((response.body as { status?: string }).status ?? "UNKNOWN");
}

export async function ensureDockerfileImage(forkUrl: string): Promise<{ name?: string; note: string }> {
  const slug = repoSlug(forkUrl);
  let environment = (await listEnvironments(slug))[0];
  if (!environment?.id) environment = await createEnvironment(forkUrl, slug);
  if (!environment.id) throw new Error(`No environment id for ${slug}`);
  let active = await activeBuild(environment.id);
  if (!needsDockerfileBuild(active)) {
    return { name: environment.name, note: `Dockerfile image already active for ${slug}` };
  }
  const buildId = await startBuild(environment.id);
  const deadline = Date.now() + 25 * 60 * 1000;
  let status = "IN_PROGRESS";
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    status = await buildStatus(environment.id, buildId);
    if (status !== "IN_PROGRESS") break;
  }
  active = await activeBuild(environment.id);
  return {
    name: environment.name,
    note: `Dockerfile build ${buildId} for ${slug} is ${status}; active image is ${active.type ?? "absent"}`,
  };
}
