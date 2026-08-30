import type { PlantStage, StageThresholds } from "./types";

export const DEFAULT_THRESHOLDS: StageThresholds = {
  sprout: 0.5,
  seedling: 5,
  youngTree: 15,
  matureTree: 40
};

export function stageForScore(score: number, thresholds: StageThresholds): PlantStage {
  if (score >= thresholds.matureTree) return "mature-tree";
  if (score >= thresholds.youngTree) return "young-tree";
  if (score >= thresholds.seedling) return "seedling";
  if (score >= thresholds.sprout) return "sprout";
  return "seed";
}

export function headingScore(
  headings: ReadonlyArray<{ level: number }> | undefined,
  h1Weight: number,
  h2Weight: number
): number {
  if (!headings) return 0;
  return headings.reduce((score, heading) => {
    if (heading.level === 1) return score + h1Weight;
    if (heading.level === 2) return score + h2Weight;
    return score;
  }, 0);
}

export function propertyLinks(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function linkPath(value: string): string {
  const unwrapped = value.startsWith("[[") && value.endsWith("]]" )
    ? value.slice(2, -2)
    : value;
  return unwrapped.split("|")[0].split("#")[0].trim();
}

export function wikiLink(path: string): string {
  return `[[${path.replace(/\.md$/i, "")}]]`;
}

export function safeFileName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|#[\]]/g, "-").replace(/\s+/g, " ");
}

export function contributionLevel(count: number, maximum: number): number {
  if (count <= 0 || maximum <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil((count / maximum) * 4)));
}
