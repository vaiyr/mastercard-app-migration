export type Setup = "env" | "h1" | "h2";

export interface CliOptions {
  setup: Setup;
  model?: string;
  budget: number;
  concurrency: number;
  target: string;
  retry: boolean;
}

export interface RepoRef {
  id: string;
  name: string;
  url: string;
  baseCommit: string;
  split?: string;
}

export interface PinnedModel {
  id: string;
  params?: Array<{ id: string; value: string }>;
}
