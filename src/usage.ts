/** Token counts copied from getUsage(). Missing fields stay "absent". */

export type TokenCount = number | "absent";

export interface UsageSnapshot {
  getUsage: unknown;
  tokens: Record<string, TokenCount>;
  chargedCents: TokenCount;
  rawCostCents: TokenCount;
  costSettled: boolean;
  error?: string;
}

const KNOWN_TOKEN_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "cacheTokens",
  "totalTokens",
  "reasoningTokens",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readCount(
  source: Record<string, unknown> | undefined,
  key: string,
): TokenCount {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return "absent";
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return "absent";
}

export function absentUsage(error?: string): UsageSnapshot {
  const tokens: Record<string, TokenCount> = {};
  for (const key of KNOWN_TOKEN_FIELDS) tokens[key] = "absent";
  return {
    getUsage: "absent",
    tokens,
    chargedCents: "absent",
    rawCostCents: "absent",
    costSettled: false,
    error,
  };
}

/** Copy the full getUsage() object and its token fields. Does not fill gaps. */
export function snapshotFromUsage(value: unknown): UsageSnapshot {
  if (!isRecord(value)) return absentUsage();
  const totals = isRecord(value.usage) ? value.usage : undefined;
  const tokens: Record<string, TokenCount> = {};
  for (const key of KNOWN_TOKEN_FIELDS) tokens[key] = readCount(totals, key);
  if (totals) {
    for (const key of Object.keys(totals)) {
      if (key in tokens) continue;
      if (!/token/i.test(key)) continue;
      tokens[key] = readCount(totals, key);
    }
  }
  const cost = isRecord(value.cost) ? value.cost : undefined;
  const chargedCents = readCount(cost, "chargedCents");
  const rawCostCents = readCount(cost, "rawCostCents");
  return {
    getUsage: value,
    tokens,
    chargedCents,
    rawCostCents,
    costSettled: chargedCents !== "absent",
  };
}
