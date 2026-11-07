/** UTC windows for a cloud run. Missing API fields stay "absent". */

export function epochToIso(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "absent";
  const ms = value < 1e12 ? value * 1000 : value;
  return new Date(ms).toISOString();
}

/**
 * Prefer the run's createdAt and duration. Use the observed clock only when the
 * API did not return that side.
 */
export function runWindow(
  createdAt: unknown,
  durationMs: unknown,
  observed?: { start?: string; end?: string },
): { startedAt: string; endedAt: string } {
  const startedAt = epochToIso(createdAt);
  const startMs = startedAt === "absent" ? undefined : Date.parse(startedAt);
  const duration = typeof durationMs === "number" && Number.isFinite(durationMs) ? durationMs : undefined;
  const endedFromApi =
    startMs !== undefined && duration !== undefined ? new Date(startMs + duration).toISOString() : "absent";
  return {
    startedAt: startedAt === "absent" ? observed?.start ?? "absent" : startedAt,
    endedAt: endedFromApi === "absent" ? observed?.end ?? "absent" : endedFromApi,
  };
}
