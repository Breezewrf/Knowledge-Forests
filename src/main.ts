import {
  FileSystemAdapter,
  Menu,
  Notice,
  normalizePath,
  Plugin,
  TFile,
  TFolder
} from "obsidian";
import { ForestIndex } from "./forest-index";
import { GitService } from "./git-service";
import { linkPath, propertyLinks, safeFileName, wikiLink } from "./model";
import { ManageSeedsModal, NameModal } from "./modals";
import { DEFAULT_SETTINGS, KnowledgeForestsSettingTab } from "./settings";
import { GITHUB_TOKEN_SECRET_ID, type KnowledgeForestsSettings } from "./types";
import { KnowledgeForestsView, VIEW_TYPE_KNOWLEDGE_FORESTS } from "./view";

export default class KnowledgeForestsPlugin extends Plugin {
  declare settings: KnowledgeForestsSettings;
  index!: ForestIndex;
  git!: GitService;
  remoteUpdatesAvailable = false;
  private refreshTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.index = new ForestIndex(this.app, this.settings);
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Knowledge Forests requires a desktop filesystem vault.");
    }
    this.git = new GitService(
      adapter.getBasePath(),
      adapter,
      this.settings,
      () => this.app.secretStorage.getSecret(GITHUB_TOKEN_SECRET_ID)
    );
    this.index.rebuild();

    this.registerView(VIEW_TYPE_KNOWLEDGE_FORESTS, (leaf) => new KnowledgeForestsView(leaf, this));
    this.addRibbonIcon("trees", "Open Knowledge Forests", () => void this.activateView());
    this.addCommand({ id: "open", name: "Open", callback: () => void this.activateView() });
    this.addCommand({ id: "sow-seed", name: "Sow seed", callback: () => this.openSowSeedModal() });
    this.addCommand({ id: "new-forest", name: "Create forest", callback: () => this.openNewForestModal() });
    this.addCommand({ id: "sync", name: "Sync with Git remote", callback: () => void this.syncFromCommand() });
    this.addCommand({ id: "rebuild-index", name: "Rebuild forest index", callback: () => this.scheduleRefresh(0) });
    this.addSettingTab(new KnowledgeForestsSettingTab(this.app, this));

    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof TFile && file.extension === "md" && !this.isForestRecord(file)) {
        this.addManageSeedsMenuItem(menu, file);
      }
    }));

    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") void this.checkRemoteUpdates();
    });
    this.registerInterval(window.setInterval(() => void this.checkRemoteUpdates(), 5 * 60 * 1000));
    this.app.workspace.onLayoutReady(() => {
      this.scheduleRefresh(0);
      void this.checkRemoteUpdates();
    });
  }

  onunload(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
  }

  async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_KNOWLEDGE_FORESTS)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeftLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_KNOWLEDGE_FORESTS, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  openSowSeedModal(): void {
    new NameModal(this.app, "Sow a knowledge seed", "Sow seed", async (name) => {
      const safeName = safeFileName(name);
      if (!safeName) throw new Error("Seed name is not valid.");
      const existing = this.index.getSnapshot().seeds.find((seed) => seed.name.localeCompare(safeName, undefined, { sensitivity: "accent" }) === 0);
      if (existing) {
        await this.app.workspace.getLeaf(false).openFile(existing.file);
        new Notice(`Seed “${safeName}” already exists.`);
        return;
      }
      await this.ensureFolder(this.settings.seedFolder);
      const path = normalizePath(`${this.settings.seedFolder}/${safeName}.md`);
      const content = `---\nforest-kind: seed\nforest-id: "${crypto.randomUUID()}"\nforests: []\ncreated: ${today()}\n---\n\n# ${safeName}\n\n## Why I planted this seed\n\n## Questions to explore\n\n## Cultivation notes\n`;
      const file = await this.app.vault.create(path, content);
      this.scheduleRefresh(0);
      await this.app.workspace.getLeaf(false).openFile(file);
    }).open();
  }

  openNewForestModal(): void {
    new NameModal(this.app, "Create a knowledge forest", "Create forest", async (name) => {
      const safeName = safeFileName(name);
      if (!safeName) throw new Error("Forest name is not valid.");
      const existing = this.index.getSnapshot().forests.find((forest) => forest.name.localeCompare(safeName, undefined, { sensitivity: "accent" }) === 0);
      if (existing) {
        await this.app.workspace.getLeaf(false).openFile(existing.file);
        new Notice(`Forest “${safeName}” already exists.`);
        return;
      }
      await this.ensureFolder(this.settings.forestFolder);
      const path = normalizePath(`${this.settings.forestFolder}/${safeName}.md`);
      const content = `---\nforest-kind: forest\nforest-id: "${crypto.randomUUID()}"\ncreated: ${today()}\n---\n\n# ${safeName}\n`;
      const file = await this.app.vault.create(path, content);
      this.scheduleRefresh(0);
      await this.app.workspace.getLeaf(false).openFile(file);
    }).open();
  }

  openManageSeeds(file: TFile): void {
    const current = this.currentSeedPaths(file);
    new ManageSeedsModal(this.app, file, this.index.getSnapshot().seeds, current, async (paths) => {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        if (paths.length === 0) delete frontmatter.seeds;
        else frontmatter.seeds = paths.map(wikiLink);
      });
      this.scheduleRefresh(0);
    }).open();
  }

  async addSeedToForest(seedPath: string, forestPath: string): Promise<void> {
    const seed = this.app.vault.getAbstractFileByPath(seedPath);
    const forest = this.app.vault.getAbstractFileByPath(forestPath);
    if (seed instanceof TFile && forest instanceof TFile) await this.setSeedForest(seed, forest, true);
  }

  async moveSeedToForest(seedPath: string, forestPath: string | null): Promise<void> {
    const seed = this.app.vault.getAbstractFileByPath(seedPath);
    if (!(seed instanceof TFile)) return;
    await this.app.fileManager.processFrontMatter(seed, (frontmatter) => {
      frontmatter.forests = forestPath ? [wikiLink(forestPath)] : [];
    });
    this.scheduleRefresh(0);
  }

  async setSeedForest(seed: TFile, forest: TFile, included: boolean): Promise<void> {
    await this.app.fileManager.processFrontMatter(seed, (frontmatter) => {
      const links = propertyLinks(frontmatter.forests);
      const paths = new Map<string, string>();
      for (const link of links) paths.set(linkPath(link), link);
      const forestLink = wikiLink(forest.path);
      const key = linkPath(forestLink);
      if (included) paths.set(key, forestLink);
      else paths.delete(key);
      frontmatter.forests = [...paths.values()];
    });
    this.scheduleRefresh(0);
  }

  async saveSettingsAndRefresh(): Promise<void> {
    await this.saveData(this.settings);
    this.index.rebuild();
    await this.refreshViews();
  }

  async setActivityRange(days: number): Promise<void> {
    if (![30, 90, 180, 365].includes(days)) return;
    this.settings.heatmapDays = days;
    await this.saveData(this.settings);
    await this.refreshViews();
  }

  private async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<KnowledgeForestsSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(loaded ?? {}),
      thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(loaded?.thresholds ?? {}) }
    };
    delete (this.settings as unknown as Record<string, unknown>).gitBranch;
    if (loaded?.heatmapDays === 365) this.settings.heatmapDays = 90;
    if (loaded?.gitRemoteUrl?.startsWith("https://github.com/" ) && loaded.gitAuthMode == null) {
      this.settings.gitAuthMode = "github-token";
    }
  }

  private currentSeedPaths(file: TFile): string[] {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const result: string[] = [];
    for (const link of propertyLinks(frontmatter?.seeds)) {
      const target = this.app.metadataCache.getFirstLinkpathDest(linkPath(link), file.path);
      if (target && this.index.seedForPath(target.path)) result.push(target.path);
    }
    return result;
  }

  private isForestRecord(file: TFile): boolean {
    const kind = this.app.metadataCache.getFileCache(file)?.frontmatter?.["forest-kind"];
    return kind === "seed" || kind === "forest";
  }

  private addManageSeedsMenuItem(menu: Menu, file: TFile): void {
    menu.addItem((item) => item.setTitle("Manage seeds").setIcon("sprout").onClick(() => this.openManageSeeds(file)));
  }

  private scheduleRefresh(delay = 200): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.index.rebuild();
      void this.refreshViews();
    }, delay);
  }

  private async refreshViews(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_KNOWLEDGE_FORESTS);
    await Promise.all(leaves.map(async (leaf) => {
      const view = leaf.view;
      if (view instanceof KnowledgeForestsView) await view.refresh();
    }));
  }

  private async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const segments = normalized.split("/");
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (!existing) await this.app.vault.createFolder(current);
      else if (!(existing instanceof TFolder)) throw new Error(`${current} exists and is not a folder.`);
    }
  }

  private async syncFromCommand(): Promise<void> {
    await this.activateView();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_KNOWLEDGE_FORESTS)[0];
    if (leaf?.view instanceof KnowledgeForestsView) await leaf.view.startSync();
  }

  private async checkRemoteUpdates(): Promise<void> {
    try {
      const available = await this.git.remoteHasUpdates();
      if (available !== this.remoteUpdatesAvailable) {
        this.remoteUpdatesAvailable = available;
        await this.refreshViews();
      }
    } catch {
      // Authentication and network errors are surfaced by explicit Sync, not background polling.
    }
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
