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

export async function ensureRepo(
  token: string,
  owner: string,
  name: string,
): Promise<string> {
  const existing = await request(token, "GET", `/repos/${owner}/${name}`);
  if (existing.status === 200) return `https://github.com/${owner}/${name}`;
  const ownerInfo = await fetch(`https://api.github.com/users/${owner}`, {
    headers: { "User-Agent": "migration-harness", Accept: "application/vnd.github+json" },
  });
  const ownerBody = (await ownerInfo.json()) as { type?: string };
  const path = ownerBody.type === "Organization" ? `/orgs/${owner}/repos` : "/user/repos";
  const created = await request(token, "POST", path, {
    name,
    private: false,
    auto_init: false,
    description: "Fork used by the Java migration harness",
  });
  if (created.status === 201) return `https://github.com/${owner}/${name}`;
  const detail = created.permissions
    ? ` Missing permission: ${created.permissions}.`
    : "";
  throw new Error(
    `Could not create ${owner}/${name} (${created.status}).${detail} ${created.body.slice(0, 300)}`,
  );
}

export function authedRemote(forkUrl: string, token: string): string {
  const url = new URL(forkUrl);
  url.username = "x-access-token";
  url.password = token;
  return url.toString();
}
