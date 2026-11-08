import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { Agent, type McpServerConfig, type Run, type SDKAgent } from "@cursor/sdk";
import { need } from "./env.js";
import { selection } from "./model.js";
import { pushNudge } from "./prompts.js";
import type { Attempt, PinnedModel, Setup } from "./types.js";

export const MAX_MINUTES = 45;
/** How long to wait for the stream or wait() after the run was cancelled or went quiet at the end. */
const SETTLE_MS = 90_000;

/** h1 gets the version lookup server; h2 has the versions in the pom already. */
function mcpServers(setup: Setup): Record<string, McpServerConfig> | undefined {
  if (setup !== "h1") return undefined;
  return { "deps-lookup": { type: "stdio", command: "python3", args: ["tools/deps-lookup/server.py"] } };
}

export interface AgentRunInput {
  forkUrl: string;
  startingRef: string;
  setup: Setup;
  model: PinnedModel;
  name: string;
  metadata: Record<string, string>;
  prompt: string;
  budget: number;
  ndjsonPath: string;
  /** The branch the prompt tells the agent to push. */
  branch: string;
  target: string;
  /** Does the branch exist on the fork now? Checked after each turn. */
  branchPushed: () => Promise<boolean>;
  /** Resume this agent instead of creating one (the retry path). */
  resumeId?: string;
}

export interface AgentRun {
  agent: SDKAgent;
  attempt: Attempt;
}

const sleep = (ms: number) => new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms));

/** The agent's status from the REST API. Used when the SDK run does not settle. */
export async function agentState(agentId: string): Promise<{ status: string }> {
  const response = await fetch(`https://api.cursor.com/v0/agents/${agentId}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${need("CURSOR_API_KEY")}:`).toString("base64")}` },
  });
  if (!response.ok) return { status: `http ${response.status}` };
  const body = (await response.json()) as { status?: string };
  return { status: body.status ?? "unknown" };
}

/**
 * Create or resume a cloud agent, send one prompt, and stream every event to
 * run.ndjson. The run is cancelled at the tool-call budget or at MAX_MINUTES.
 *
 * A cancel that lands as the run finishes on its own can leave the SDK stream
 * and wait() pending, so both are raced against SETTLE_MS and the REST API is
 * the fallback for status and branch.
 */
export async function runAgent(input: AgentRunInput, kind: Attempt["kind"]): Promise<AgentRun> {
  const servers = mcpServers(input.setup);
  const agent = input.resumeId
    ? await Agent.resume(input.resumeId, { model: selection(input.model), mcpServers: servers })
    : await Agent.create({
        model: selection(input.model),
        name: input.name.slice(0, 80),
        mcpServers: servers,
        cloud: {
          repos: [{ url: input.forkUrl, startingRef: input.startingRef }],
          autoCreatePR: false,
          metadata: input.metadata,
        },
      });

  const stream = createWriteStream(input.ndjsonPath, { flags: "a" });
  const write = async (value: unknown) => {
    if (!stream.write(`${JSON.stringify(value)}\n`)) await once(stream, "drain");
  };
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const calls = new Set<string>();
  let run: Run | undefined;
  let stopReason: Attempt["stopReason"] = "finished";
  let cancelled = false;
  const cancel = async (reason: Attempt["stopReason"]) => {
    if (cancelled) return;
    cancelled = true;
    stopReason = reason;
    await run?.cancel();
  };
  const finish = (branch: string | undefined, error?: string): AgentRun => ({
    agent,
    attempt: {
      kind,
      stopReason,
      startedAt,
      endedAt: new Date().toISOString(),
      minutes: Number(((Date.now() - started) / 60_000).toFixed(2)),
      calls: calls.size,
      branch,
      error,
    },
  });

  /** Stream one run to the ndjson file, counting tool calls and enforcing the budget and clock. */
  const consume = async (current: Run): Promise<void> => {
    run = current;
    const events = current.stream()[Symbol.asyncIterator]();
    for (;;) {
      const idle = cancelled ? SETTLE_MS : MAX_MINUTES * 60_000 - (Date.now() - started);
      const next = await Promise.race([events.next(), sleep(Math.max(idle, 1_000))]);
      if (next === "timeout") {
        if (cancelled) break;
        await cancel("timeout");
        continue;
      }
      if (next.done) break;
      const event = next.value as { type?: string; status?: string; call_id?: string };
      await write({ kind, at: new Date().toISOString(), event });
      if (event.type === "tool_call" && event.status === "running" && event.call_id) {
        calls.add(event.call_id);
        if (calls.size >= input.budget) await cancel("budget");
      }
      if (Date.now() - started > MAX_MINUTES * 60_000) await cancel("timeout");
    }
    const settled = await Promise.race([current.wait(), sleep(SETTLE_MS)]);
    if (settled !== "timeout") {
      if (!(settled.status === "finished" || cancelled)) throw new Error(`run ${settled.status}`);
      return;
    }
    await write({ kind, at: new Date().toISOString(), note: "run.wait() did not settle within SETTLE_MS; using REST status" });
    const state = await agentState(agent.agentId);
    if (!(state.status === "FINISHED" || cancelled)) throw new Error(`agent ${state.status}`);
  };

  let nudged = false;
  try {
    await consume(await agent.send(input.prompt, { mcpServers: servers }));
    let pushed = await input.branchPushed();
    if (!pushed) {
      nudged = true;
      cancelled = false;
      await write({ kind, at: new Date().toISOString(), note: `branch ${input.branch} not on the fork after the run; asking the agent to commit and push` });
      await consume(await agent.send(pushNudge(input.branch, input.target), { mcpServers: servers }));
      pushed = await input.branchPushed();
    }
    const result = finish(pushed ? input.branch : undefined);
    result.attempt.nudged = nudged;
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await write({ kind, at: new Date().toISOString(), error: message });
    stopReason = "error";
    return finish(undefined, message);
  } finally {
    stream.end();
    await once(stream, "finish");
  }
}

export function agentUrl(agentId: string): string {
  return `https://cursor.com/agents/${agentId}`;
}
