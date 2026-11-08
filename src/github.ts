import { scrub } from "./env.js";

async function api(token: string, method: string, route: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`https://api.github.com${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "migration-harness",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { raw: scrub(text, token) };
  }
  return { status: response.status, json };
}

/** A private repo `owner/name`, created when missing. Returns its https URL. */
export async function ensurePrivateRepo(token: string, owner: string, name: string): Promise<string> {
  const url = `https://github.com/${owner}/${name}`;
  const existing = await api(token, "GET", `/repos/${owner}/${name}`);
  if (existing.status === 200) {
    if (existing.json.private !== true) {
      const patched = await api(token, "PATCH", `/repos/${owner}/${name}`, { private: true });
      if (patched.status !== 200) throw new Error(`Could not make ${owner}/${name} private (${patched.status})`);
    }
    return url;
  }
  const account = await api(token, "GET", `/users/${owner}`);
  const route = account.json.type === "Organization" ? `/orgs/${owner}/repos` : "/user/repos";
  const created = await api(token, "POST", route, {
    name,
    private: true,
    auto_init: false,
    description: "Fork used by the Java migration harness",
  });
  if (created.status !== 201) {
    throw new Error(`Could not create ${owner}/${name} (${created.status}): ${JSON.stringify(created.json).slice(0, 200)}`);
  }
  return url;
}

export function authedRemote(url: string, token: string): string {
  const remote = new URL(url);
  remote.username = "x-access-token";
  remote.password = token;
  return remote.toString();
}
