/** Sums from POST /teams/filtered-usage-events. Missing fields stay "absent". */

export type UsageSum = number | "absent";

export interface TeamUsage {
  inputTokens: UsageSum;
  outputTokens: UsageSum;
  cacheReadTokens: UsageSum;
  cacheWriteTokens: UsageSum;
  chargedCents: UsageSum;
  totalCents: UsageSum;
  eventCount: number;
  error?: string;
}

const FIELDS = {
  inputTokens: ["tokenUsage", "inputTokens"],
  outputTokens: ["tokenUsage", "outputTokens"],
  cacheReadTokens: ["tokenUsage", "cacheReadTokens"],
  cacheWriteTokens: ["tokenUsage", "cacheWriteTokens"],
  totalCents: ["tokenUsage", "totalCents"],
  chargedCents: ["chargedCents"],
} as const;

type FieldName = keyof typeof FIELDS;

function readNumber(event: Record<string, unknown>, path: readonly string[]): number | undefined {
  let current: unknown = event;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : undefined;
}

export function emptyTeamUsage(error?: string): TeamUsage {
  return {
    inputTokens: "absent",
    outputTokens: "absent",
    cacheReadTokens: "absent",
    cacheWriteTokens: "absent",
    chargedCents: "absent",
    totalCents: "absent",
    eventCount: 0,
    ...(error ? { error } : {}),
  };
}

export function sumUsageEvents(events: unknown[]): TeamUsage {
  const totals: Partial<Record<FieldName, number>> = {};
  let eventCount = 0;
  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    eventCount += 1;
    for (const [name, path] of Object.entries(FIELDS) as Array<[FieldName, readonly string[]]>) {
      const value = readNumber(event as Record<string, unknown>, path);
      if (value === undefined) continue;
      totals[name] = (totals[name] ?? 0) + value;
    }
  }
  const field = (name: FieldName): UsageSum => (name in totals ? totals[name]! : "absent");
  return {
    inputTokens: field("inputTokens"),
    outputTokens: field("outputTokens"),
    cacheReadTokens: field("cacheReadTokens"),
    cacheWriteTokens: field("cacheWriteTokens"),
    chargedCents: field("chargedCents"),
    totalCents: field("totalCents"),
    eventCount,
  };
}

function windowMillis(startedAt: string | undefined, endedAt: string | undefined): { startDate: number; endDate: number } {
  const start = startedAt && startedAt !== "absent" ? Date.parse(startedAt) : Date.parse("2026-11-06T00:00:00.000Z");
  const end = endedAt && endedAt !== "absent" ? Date.parse(endedAt) : Date.now();
  return {
    startDate: (Number.isFinite(start) ? start : Date.parse("2026-11-06T00:00:00.000Z")) - 60 * 60 * 1000,
    endDate: (Number.isFinite(end) ? end : Date.now()) + 6 * 60 * 60 * 1000,
  };
}

export async function fetchTeamUsage(
  agentId: string,
  startedAt?: string,
  endedAt?: string,
): Promise<TeamUsage> {
  const key = process.env.CURSOR_ADMIN_API_KEY;
  if (!key) return emptyTeamUsage("CURSOR_ADMIN_API_KEY is not set");
  const { startDate, endDate } = windowMillis(startedAt, endedAt);
  const events: unknown[] = [];
  let page = 1;
  try {
    for (;;) {
      const response = await fetch("https://api.cursor.com/teams/filtered-usage-events", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate,
          cloudAgentId: agentId,
          page,
          pageSize: 1000,
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        return emptyTeamUsage(`filtered-usage-events returned ${response.status}`);
      }
      const body = JSON.parse(text) as {
        usageEvents?: unknown[];
        pagination?: { hasNextPage?: boolean };
      };
      events.push(...(body.usageEvents ?? []));
      if (!body.pagination?.hasNextPage) break;
      page += 1;
      if (page > 20) break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emptyTeamUsage(message.split(key).join("[REDACTED]"));
  }
  return sumUsageEvents(events);
}
