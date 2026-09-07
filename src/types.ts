import type { TFile } from "obsidian";

export const GITHUB_TOKEN_SECRET_ID = "knowledge-forests-github-token";

export type PlantStage = "seed" | "sprout" | "seedling" | "young-tree" | "mature-tree";
export type ForestTab = "seeds" | "files" | "forests" | "activity";

export interface StageThresholds {
  sprout: number;
  seedling: number;
  youngTree: number;
  matureTree: number;
}

export interface KnowledgeForestsSettings {
  seedFolder: string;
  forestFolder: string;
  templateFolder: string;
  h1Weight: number;
  h2Weight: number;
  thresholds: StageThresholds;
  gitRemoteUrl: string;
  gitAuthMode: "system" | "github-token";
  gitAuthorName: string;
  gitAuthorEmail: string;
  commitMessageTemplate: string;
  heatmapDays: number;
}

export interface SeedRecord {
  id: string;
  name: string;
  file: TFile;
  noteFiles: TFile[];
  forests: string[];
  score: number;
  stage: PlantStage;
}

export interface ForestRecord {
  id: string;
  name: string;
  file: TFile;
  seeds: SeedRecord[];
}

export interface FileRecord {
  file: TFile;
  seeds: SeedRecord[];
  unresolvedSeeds: string[];
}

export interface ForestSnapshot {
  seeds: SeedRecord[];
  forests: ForestRecord[];
  files: FileRecord[];
}

export interface ContributionDay {
  date: string;
  count: number;
  commits: ContributionCommit[];
}

export interface ContributionCommit {
  hash: string;
  date: string;
  email: string;
  subject: string;
}

export interface GitStatus {
  repository: boolean;
  dirty: boolean;
  ahead: number;
  behind: number;
  conflicts: number;
  message?: string;
}

export type SyncPhase = "saving" | "merging" | "uploading" | "complete" | "conflict" | "error";

export interface SyncProgress {
  phase: SyncPhase;
  message: string;
  progress: number;
}

export interface GitConflict {
  path: string;
  localContent: string | null;
  remoteContent: string | null;
  workingContent: string | null;
  binary: boolean;
}

export interface SyncResult {
  status: "complete" | "conflict" | "unrelated";
  committed: boolean;
  message: string;
  conflicts: GitConflict[];
}

export interface PlantRenderer {
  render(seed: SeedRecord, container: HTMLElement): void;
  destroy(): void;
}
