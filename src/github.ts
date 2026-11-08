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

/** The upstream repo's own CI would run on our fork and fail there; keep it off. */
async function disableActions(token: string, owner: string, name: string): Promise<void> {
  await api(token, "PUT", `/repos/${owner}/${name}/actions/permissions`, { enabled: false });
}

/** A private repo `owner/name` with Actions off, created when missing. Returns its https URL. */
export async function ensurePrivateRepo(token: string, owner: string, name: string): Promise<string> {
  const url = `https://github.com/${owner}/${name}`;
  const existing = await api(token, "GET", `/repos/${owner}/${name}`);
  if (existing.status === 200) {
    if (existing.json.private !== true) {
      const patched = await api(token, "PATCH", `/repos/${owner}/${name}`, { private: true });
      if (patched.status !== 200) throw new Error(`Could not make ${owner}/${name} private (${patched.status})`);
    }
    await disableActions(token, owner, name);
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
  if (created.status === 201) {
    await disableActions(token, owner, name);
    return url;
  }
  // Four runs starting at once all see "missing" and all try to create; the losers get 422 "name already exists".
  if (created.status === 422 && JSON.stringify(created.json).includes("already exists")) {
    const again = await api(token, "GET", `/repos/${owner}/${name}`);
    if (again.status === 200) return url;
  }
  throw new Error(`Could not create ${owner}/${name} (${created.status}): ${JSON.stringify(created.json).slice(0, 200)}`);
}

export function authedRemote(url: string, token: string): string {
  const remote = new URL(url);
  remote.username = "x-access-token";
  remote.password = token;
  return remote.toString();
}

/** Open a pull request on the fork, or return the one that already exists for that head. */
export async function openPullRequest(token: string, owner: string, name: string, input: { head: string; base: string; title: string; body: string }): Promise<string> {
  const created = await api(token, "POST", `/repos/${owner}/${name}/pulls`, { title: input.title, body: input.body, head: input.head, base: input.base });
  if (created.status === 201 && typeof created.json.html_url === "string") return created.json.html_url;
  const existing = await api(token, "GET", `/repos/${owner}/${name}/pulls?state=all&head=${owner}:${encodeURIComponent(input.head)}`);
  const list = (existing.json as unknown) as Array<{ html_url?: string }>;
  if (Array.isArray(list) && list[0]?.html_url) return list[0].html_url;
  throw new Error(`Could not open a pull request on ${owner}/${name} (${created.status}): ${JSON.stringify(created.json).slice(0, 200)}`);
}
