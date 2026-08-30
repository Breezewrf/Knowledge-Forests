import { App, TFile } from "obsidian";
import { headingScore, linkPath, propertyLinks, stageForScore } from "./model";
import type {
  FileRecord,
  ForestRecord,
  ForestSnapshot,
  KnowledgeForestsSettings,
  SeedRecord
} from "./types";

export class ForestIndex {
  private snapshot: ForestSnapshot = { seeds: [], forests: [], files: [] };

  constructor(private readonly app: App, private readonly settings: KnowledgeForestsSettings) {}

  rebuild(): ForestSnapshot {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const seedsByPath = new Map<string, SeedRecord>();
    const forestsByPath = new Map<string, ForestRecord>();

    for (const file of markdownFiles) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const kind = frontmatter?.["forest-kind"];
      if (kind === "seed") {
        seedsByPath.set(file.path, {
          id: String(frontmatter?.["forest-id"] ?? file.path),
          name: file.basename,
          file,
          noteFiles: [],
          forests: propertyLinks(frontmatter?.forests),
          score: 0,
          stage: "seed"
        });
      } else if (kind === "forest") {
        forestsByPath.set(file.path, {
          id: String(frontmatter?.["forest-id"] ?? file.path),
          name: file.basename,
          file,
          seeds: []
        });
      }
    }

    const files: FileRecord[] = [];
    for (const file of markdownFiles) {
      if (this.isForestRecord(file) || this.isExcluded(file)) continue;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const seedProperties = propertyLinks(frontmatter?.seeds);
      const resolvedSeeds: SeedRecord[] = [];
      const unresolvedSeeds: string[] = [];

      for (const property of seedProperties) {
        const resolved = this.resolveRecord(property, file, seedsByPath);
        if (resolved) {
          if (!resolvedSeeds.includes(resolved)) resolvedSeeds.push(resolved);
        } else {
          unresolvedSeeds.push(property);
        }
      }

      const score = headingScore(
        this.app.metadataCache.getFileCache(file)?.headings,
        this.settings.h1Weight,
        this.settings.h2Weight
      );
      for (const seed of resolvedSeeds) {
        seed.noteFiles.push(file);
        seed.score += score;
      }
      files.push({ file, seeds: resolvedSeeds, unresolvedSeeds });
    }

    for (const seed of seedsByPath.values()) {
      seed.noteFiles.sort(sortFiles);
      seed.stage = stageForScore(seed.score, this.settings.thresholds);
      for (const forestLink of seed.forests) {
        const forest = this.resolveRecord(forestLink, seed.file, forestsByPath);
        if (forest && !forest.seeds.includes(seed)) forest.seeds.push(seed);
      }
    }

    const seeds = [...seedsByPath.values()].sort((a, b) => a.name.localeCompare(b.name));
    const forests = [...forestsByPath.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const forest of forests) forest.seeds.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => sortFiles(a.file, b.file));
    this.snapshot = { seeds, forests, files };
    return this.snapshot;
  }

  getSnapshot(): ForestSnapshot {
    return this.snapshot;
  }

  seedForPath(path: string): SeedRecord | undefined {
    return this.snapshot.seeds.find((seed) => seed.file.path === path);
  }

  private isForestRecord(file: TFile): boolean {
    const kind = this.app.metadataCache.getFileCache(file)?.frontmatter?.["forest-kind"];
    return kind === "seed" || kind === "forest";
  }

  private isExcluded(file: TFile): boolean {
    const template = this.settings.templateFolder.replace(/\/+$/, "");
    return template.length > 0 && (file.path === `${template}.md` || file.path.startsWith(`${template}/`));
  }

  private resolveRecord<T>(property: string, source: TFile, records: Map<string, T>): T | undefined {
    const path = linkPath(property);
    const target = this.app.metadataCache.getFirstLinkpathDest(path, source.path);
    return target ? records.get(target.path) : undefined;
  }
}

function sortFiles(a: TFile, b: TFile): number {
  return a.basename.localeCompare(b.basename) || a.path.localeCompare(b.path);
}
