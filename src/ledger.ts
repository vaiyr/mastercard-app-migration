import type { Cost } from "./types.js";

/**
 * Cost comes from the team usage ledger, not from agent.getUsage(). The SDK
 * reports chargedCents as 0 for plan-included usage; the ledger has the real
 * per-request charge, keyed by cloudAgentId.
 */
export interface UsageEvent {
  timestamp: string;
  model?: string;
  chargedCents?: number;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalCents?: number;
  };
}

const PAD_BEFORE_MS = 60 * 60_000;
/** Event timestamps are request times inside the run. The pad covers clock skew only, so a retry that starts a minute later is not counted. */
const PAD_AFTER_MS = 30_000;

export async function fetchUsageEvents(adminKey: string, agentId: string, startedAt: string, endedAt: string): Promise<UsageEvent[]> {
  const events: UsageEvent[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch("https://api.cursor.com/teams/filtered-usage-events", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${adminKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: Date.parse(startedAt) - PAD_BEFORE_MS,
        endDate: Date.parse(endedAt) + PAD_AFTER_MS,
        cloudAgentId: agentId,
        page,
        pageSize: 1000,
      }),
    });
    if (!response.ok) throw new Error(`filtered-usage-events returned ${response.status}`);
    const body = (await response.json()) as { usageEvents?: UsageEvent[]; pagination?: { hasNextPage?: boolean } };
    events.push(...(body.usageEvents ?? []));
    if (!body.pagination?.hasNextPage) break;
  }
  const until = Date.parse(endedAt) + PAD_AFTER_MS;
  return events.filter((event) => Number(event.timestamp) <= until);
}

export function emptyCost(error?: string): Cost {
  return {
    chargedCents: null,
    totalCents: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    events: 0,
    ...(error ? { error } : {}),
  };
}

export function sumEvents(events: UsageEvent[]): Cost {
  if (events.length === 0) return emptyCost();
  const sum = (pick: (event: UsageEvent) => number | undefined) =>
    Number(events.reduce((total, event) => total + (pick(event) ?? 0), 0).toFixed(4));
  return {
    chargedCents: sum((event) => event.chargedCents),
    totalCents: sum((event) => event.tokenUsage?.totalCents),
    inputTokens: sum((event) => event.tokenUsage?.inputTokens),
    outputTokens: sum((event) => event.tokenUsage?.outputTokens),
    cacheReadTokens: sum((event) => event.tokenUsage?.cacheReadTokens),
    cacheWriteTokens: sum((event) => event.tokenUsage?.cacheWriteTokens),
    events: events.length,
  };
}

/** Events at or after `fromIso`. Used to price a retry separately from the first attempt. */
export function eventsFrom(events: UsageEvent[], fromIso: string): UsageEvent[] {
  const from = Date.parse(fromIso);
  return events.filter((event) => Number(event.timestamp) >= from);
}

/**
 * Ledger events land a little after a run ends. Poll until two reads agree,
 * or give up after `maxMs` and report what is there.
 */
export async function settledEvents(adminKey: string, agentId: string, startedAt: string, endedAt: string, maxMs = 120_000): Promise<UsageEvent[]> {
  const deadline = Date.now() + maxMs;
  let previous = await fetchUsageEvents(adminKey, agentId, startedAt, endedAt);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    const current = await fetchUsageEvents(adminKey, agentId, startedAt, endedAt);
    if (current.length === previous.length && current.length > 0) return current;
    previous = current;
  }
  return previous;
}
