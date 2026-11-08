export type Setup = "h1" | "h2";

export interface Options {
  setup: Setup;
  model: string;
  repos: string;
  only?: string;
  retry: boolean;
  mavenErrors: boolean;
  concurrency: number;
  budget: number;
  target: "17" | "21";
  name: string;
  out: string;
  /** Resume the agents that missed in this earlier run directory, retry only. */
  retryRun?: string;
}

export interface RepoRef {
  name: string;
  url: string;
  baseCommit: string;
}

export interface PinnedModel {
  id: string;
  params?: Array<{ id: string; value: string }>;
}

export interface DependencyMiss {
  dependency: string;
  expected?: string;
  got?: string;
}

/** One criterion per field. See grader/grade.py for what each check means. */
export interface Verdict {
  r1: boolean;
  r2: boolean;
  r3: boolean;
  r4: boolean;
  r5: boolean;
  minimal: boolean;
  maximal: boolean;
  classMajors: number[];
  tests: number | null;
  testsRequired: number;
  trackedDependencies: number;
  dependencyMisses: DependencyMiss[];
  diffApplied: boolean;
  /** Maven error lines when r1 failed. Diagnostics only; the retry prompt does not use them. */
  verifyErrors?: string[];
  /** Why r3 failed: test files added or removed, methods added or removed. */
  testSetChanges?: string[];
  official?: { maximal: boolean; minimal: boolean };
  agreesWithOfficial?: boolean;
  error?: string;
}

export interface Cost {
  chargedCents: number | null;
  totalCents: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  events: number;
  error?: string;
}

export interface Attempt {
  kind: "first" | "retry";
  /** finished: the agent ended its turn. budget or timeout: the harness cancelled it. */
  stopReason: "finished" | "budget" | "timeout" | "error";
  startedAt: string;
  endedAt: string;
  minutes: number;
  calls: number;
  branch?: string;
  /** True when the run ended with no branch and one "commit now" message was sent. */
  nudged?: boolean;
  error?: string;
  verdict?: Verdict;
  cost?: Cost;
}

export interface Report {
  run: string;
  repo: string;
  upstreamUrl: string;
  baseCommit: string;
  forkUrl: string;
  harnessCommit: string;
  harnessBranch?: string;
  setup: Setup;
  model: PinnedModel;
  target: string;
  retry: boolean;
  mavenErrors: boolean;
  agentId: string;
  agentUrl: string;
  branch?: string;
  attempts: Attempt[];
  calls: number;
  minutes: number;
  startedAt: string;
  endedAt: string;
  verdict: Verdict;
  cost: Cost;
  error?: string;
}
