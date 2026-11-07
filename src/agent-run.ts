import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { Agent, type McpServerConfig, type Run, type RunResult, type SDKAgent, type SDKMessage } from "@cursor/sdk";
import { MAX_MINUTES } from "./limits.js";
import { promptFor, retryPrompt } from "./prompts.js";
import type { PinnedModel, Setup } from "./types.js";
import { selectionFrom } from "./model.js";

export interface RunCapture {
  agentId: string;
  agentUrl: string;
  runId: string;
  result?: RunResult;
  calls: number;
  minutes: number;
  branch?: string;
  prUrl?: string;
  ndjsonPath: string;
  error?: string;
}

function mcpServers(setup: Setup): Record<string, McpServerConfig> | undefined {
  if (setup !== "h1") return undefined;
  return {
    "deps-lookup": {
      type: "stdio",
      command: "python3",
      args: ["tools/deps-lookup/server.py"],
    },
  };
}

async function writeEvent(
  stream: ReturnType<typeof createWriteStream>,
  value: unknown,
): Promise<void> {
  const line = `${JSON.stringify(value)}\n`;
  if (!stream.write(line)) await once(stream, "drain");
}

function branchFor(result: RunResult | undefined, forkUrl: string): { branch?: string; prUrl?: string } {
  const branches = result?.git?.branches ?? [];
  const match =
    branches.find((entry) => entry.repoUrl.replace(/\.git$/, "") === forkUrl.replace(/\.git$/, "")) ??
    branches[0];
  return { branch: match?.branch, prUrl: match?.prUrl };
}

export function isUsageLimit(message: string | undefined): boolean {
  return Boolean(message?.includes("usage_limit_exceeded"));
}

export async function runCloudAgent(input: {
  forkUrl: string;
  setup: Setup;
  target: string;
  budget: number;
  model: PinnedModel;
  repoLabel: string;
  ndjsonPath: string;
  retryFailure?: string;
  resumeId?: string;
  startingRef?: string;
}): Promise<{ agent: SDKAgent; capture: RunCapture }> {
  const model = selectionFrom(input.model);
  const agent = input.resumeId
    ? await Agent.resume(input.resumeId, {
        model,
        mcpServers: mcpServers(input.setup),
      })
    : await Agent.create({
        model,
        name: `harness-${input.setup}-${input.repoLabel}`.slice(0, 80),
        mcpServers: mcpServers(input.setup),
        cloud: {
          repos: [{ url: input.forkUrl, startingRef: input.startingRef ?? "main" }],
          autoCreatePR: false,
          metadata: {
            setup: input.setup,
            model: input.model.id,
            repo: input.repoLabel,
            sweep: input.setup === "env" ? "env-proof" : "single",
          },
        },
      });

  const stream = createWriteStream(input.ndjsonPath, { flags: "a" });
  const started = Date.now();
  const seen = new Set<string>();
  let calls = 0;
  let run: Run | undefined;
  const noteCall = async (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    calls = seen.size;
    if (calls >= input.budget && run) await run.cancel();
  };
  const prompt = input.retryFailure
    ? retryPrompt(input.retryFailure)
    : promptFor(input.setup, input.target, input.budget);

  try {
    run = await agent.send(prompt, {
      mcpServers: mcpServers(input.setup),
      onStep: async ({ step }) => {
        await writeEvent(stream, { kind: "step", at: new Date().toISOString(), step });
      },
    });
    const timer = setInterval(() => {
      if (Date.now() - started > MAX_MINUTES * 60_000) void run?.cancel();
    }, 15_000);
    try {
      for await (const event of run.stream()) {
        await writeEvent(stream, { kind: "event", event: event as SDKMessage });
        if (event.type === "tool_call" && event.status === "running") {
          await noteCall(event.call_id);
        }
        if (Date.now() - started > MAX_MINUTES * 60_000) await run.cancel();
      }
    } finally {
      clearInterval(timer);
    }
    const result = await run.wait();
    const located = branchFor(result, input.forkUrl);
    const capture: RunCapture = {
      agentId: agent.agentId,
      agentUrl: `https://cursor.com/agents/${agent.agentId}`,
      runId: result.id,
      result,
      calls,
      minutes: (result.durationMs ?? Date.now() - started) / 60_000,
      branch: located.branch,
      prUrl: located.prUrl,
      ndjsonPath: input.ndjsonPath,
    };
    return { agent, capture };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeEvent(stream, { kind: "error", message });
    return {
      agent,
      capture: {
        agentId: agent.agentId,
        agentUrl: `https://cursor.com/agents/${agent.agentId}`,
        runId: run?.id ?? "",
        calls,
        minutes: (Date.now() - started) / 60_000,
        ndjsonPath: input.ndjsonPath,
        error: message,
      },
    };
  } finally {
    stream.end();
    await once(stream, "finish");
  }
}

export async function pollChargedCents(agent: SDKAgent): Promise<{
  chargedCents: number | null;
  rawCostCents: number | null;
  settled: boolean;
}> {
  const deadline = Date.now() + 3 * 60_000;
  let last: Awaited<ReturnType<SDKAgent["getUsage"]>> | undefined;
  while (Date.now() < deadline) {
    last = await agent.getUsage();
    if (last.cost) {
      return {
        chargedCents: last.cost.chargedCents,
        rawCostCents: last.cost.rawCostCents,
        settled: true,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  return {
    chargedCents: last?.cost?.chargedCents ?? null,
    rawCostCents: last?.cost?.rawCostCents ?? null,
    settled: Boolean(last?.cost),
  };
}
