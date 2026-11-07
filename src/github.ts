import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function scrub(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join("[REDACTED]");
}

export async function githubToken(): Promise<string> {
  if (process.env.HARNESS_GITHUB_TOKEN) return process.env.HARNESS_GITHUB_TOKEN;
  const { stdout } = await execFileAsync("gh", ["auth", "token"], { timeout: 15_000 });
  const token = stdout.trim();
  if (!token) throw new Error("No GitHub token. Set HARNESS_GITHUB_TOKEN.");
  return token;
}

interface GithubResponse {
  status: number;
  body: string;
  permissions: string;
}

async function request(
  token: string,
  method: string,
  path: string,
  payload?: unknown,
): Promise<GithubResponse> {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "migration-harness",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return {
    status: response.status,
    body: await response.text(),
    permissions: response.headers.get("x-accepted-github-permissions") ?? "",
  };
}

export function newRepoBody(name: string): {
  name: string;
  private: true;
  auto_init: false;
  description: string;
} {
  return {
    name,
    private: true,
    auto_init: false,
    description: "Fork used by the Java migration harness",
  };
}

/** PATCH a public fork to private, then read it back. Already-private repos are left as they are. */
export async function makePrivate(
  token: string,
  owner: string,
  name: string,
  body: string,
): Promise<boolean> {
  let parsed: { private?: boolean } = {};
  try {
    parsed = JSON.parse(body) as { private?: boolean };
  } catch {
    parsed = {};
  }
  if (parsed.private !== true) {
    const patched = await request(token, "PATCH", `/repos/${owner}/${name}`, { private: true });
    if (patched.status !== 200) {
      throw new Error(
        `Could not make ${owner}/${name} private (${patched.status}). ${patched.body.slice(0, 200)}`,
      );
    }
  }
  const check = await request(token, "GET", `/repos/${owner}/${name}`);
  let confirmed: { private?: boolean } = {};
  try {
    confirmed = JSON.parse(check.body) as { private?: boolean };
  } catch {
    confirmed = {};
  }
  if (check.status !== 200 || confirmed.private !== true) {
    throw new Error(`${owner}/${name} is not private after the visibility update`);
  }
  return parsed.private !== true;
}

export async function ensureRepo(
  token: string,
  owner: string,
  name: string,
): Promise<string> {
  const existing = await request(token, "GET", `/repos/${owner}/${name}`);
  if (existing.status === 200) {
    await makePrivate(token, owner, name, existing.body);
    return `https://github.com/${owner}/${name}`;
  }
  const ownerInfo = await fetch(`https://api.github.com/users/${owner}`, {
    headers: { "User-Agent": "migration-harness", Accept: "application/vnd.github+json" },
  });
  const ownerBody = (await ownerInfo.json()) as { type?: string };
  const path = ownerBody.type === "Organization" ? `/orgs/${owner}/repos` : "/user/repos";
  const created = await request(token, "POST", path, newRepoBody(name));
  if (created.status === 201) {
    await makePrivate(token, owner, name, created.body);
    return `https://github.com/${owner}/${name}`;
  }
  const detail = created.permissions
    ? ` Missing permission: ${created.permissions}.`
    : "";
  throw new Error(
    `Could not create ${owner}/${name} (${created.status}).${detail} ${created.body.slice(0, 300)}`,
  );
}

export interface RemoteCommit {
  sha: string;
  parents: string[];
}

/** `null` when the repository exists and has no commits yet. */
export async function defaultBranchCommit(
  token: string,
  owner: string,
  name: string,
): Promise<RemoteCommit | null> {
  const response = await request(token, "GET", `/repos/${owner}/${name}/commits/main`);
  if (response.status === 409 || response.status === 404) return null;
  if (response.status !== 200) {
    throw new Error(
      `Could not read ${owner}/${name}@main (${response.status}). ${response.body.slice(0, 200)}`,
    );
  }
  const body = JSON.parse(response.body) as {
    sha?: string;
    parents?: Array<{ sha?: string }>;
  };
  const sha = body.sha ?? "";
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`Unexpected commit from ${owner}/${name}@main`);
  }
  return {
    sha,
    parents: (body.parents ?? []).map((parent) => parent.sha ?? "").filter(Boolean),
  };
}

/** True when `head` is `ancestor` or a descendant of it. */
export async function commitDescendsFrom(
  token: string,
  owner: string,
  name: string,
  ancestor: string,
  head: string,
): Promise<boolean> {
  if (ancestor === head) return true;
  const response = await request(
    token,
    "GET",
    `/repos/${owner}/${name}/compare/${ancestor}...${head}`,
  );
  if (response.status !== 200) return false;
  const body = JSON.parse(response.body) as { status?: string };
  return body.status === "ahead" || body.status === "identical";
}

export async function repoFileText(
  token: string,
  owner: string,
  name: string,
  filePath: string,
  ref: string,
): Promise<string | null> {
  const response = await request(
    token,
    "GET",
    `/repos/${owner}/${name}/contents/${filePath}?ref=${encodeURIComponent(ref)}`,
  );
  if (response.status !== 200) return null;
  const body = JSON.parse(response.body) as { content?: string; encoding?: string };
  if (body.encoding !== "base64" || !body.content) return null;
  return Buffer.from(body.content.replace(/\s/g, ""), "base64").toString("utf8");
}

export async function repoHasFile(
  token: string,
  owner: string,
  name: string,
  filePath: string,
  ref: string,
): Promise<boolean> {
  const response = await request(
    token,
    "GET",
    `/repos/${owner}/${name}/contents/${filePath}?ref=${encodeURIComponent(ref)}`,
  );
  return response.status === 200;
}

export function authedRemote(forkUrl: string, token: string): string {
  const url = new URL(forkUrl);
  url.username = "x-access-token";
  url.password = token;
  return url.toString();
}
