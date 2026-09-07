import { ItemView, Menu, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import { contributionLevel } from "./model";
import { SyncConflictModal } from "./modals";
import { SvgPlantRenderer } from "./plant-renderer";
import type KnowledgeForestsPlugin from "./main";
import type { ContributionDay, ForestTab, GitConflict, SeedRecord, SyncProgress } from "./types";

export const VIEW_TYPE_KNOWLEDGE_FORESTS = "knowledge-forests-view";

export class KnowledgeForestsView extends ItemView {
  private activeTab: ForestTab = "seeds";
  private renderer = new SvgPlantRenderer();
  private highlightedSeedPath: string | null = null;
  private heatmapResizeObserver: ResizeObserver | null = null;
  private lastActivityZoomAt = 0;
  private syncRunning = false;
  private syncProgress: SyncProgress | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: KnowledgeForestsPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_KNOWLEDGE_FORESTS; }
  getDisplayText(): string { return "Knowledge Forests"; }
  getIcon(): string { return "trees"; }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.heatmapResizeObserver?.disconnect();
    this.renderer.destroy();
  }

  async refresh(): Promise<void> {
    this.heatmapResizeObserver?.disconnect();
    this.heatmapResizeObserver = null;
    this.renderer.destroy();
    const root = this.contentEl;
    root.empty();
    root.addClass("knowledge-forests-view");
    this.renderHeader(root);
    this.renderSyncStatus(root);
    this.renderTabs(root);
    const content = root.createDiv({ cls: "knowledge-forests-content" });
    if (this.activeTab === "seeds") this.renderSeeds(content);
    else if (this.activeTab === "files") this.renderFiles(content);
    else if (this.activeTab === "forests") this.renderForests(content);
    else await this.renderActivity(content);
  }

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: "knowledge-forests-header" });
    const title = header.createDiv({ cls: "knowledge-forests-title" });
    const titleIcon = title.createSpan();
    setIcon(titleIcon, "trees");
    title.createSpan({ text: "Knowledge Forests" });
    const actions = header.createDiv({ cls: "knowledge-forests-actions" });
    this.iconButton(actions, "sprout", "Sow seed", () => this.plugin.openSowSeedModal());
    this.iconButton(actions, "land-plot", "New forest", () => this.plugin.openNewForestModal());
    const syncButton = this.iconButton(actions, "cloud-upload", "Sync local and remote changes", () => void this.startSync());
    syncButton.addClass("knowledge-forests-sync-button");
    syncButton.toggleAttribute("disabled", this.syncRunning);
    void this.decorateSyncStatus(syncButton);
  }

  private renderSyncStatus(root: HTMLElement): void {
    const panel = root.createDiv({ cls: "knowledge-forests-sync-panel" });
    const row = panel.createDiv({ cls: "knowledge-forests-sync-row" });
    const indicator = row.createSpan({ cls: "knowledge-forests-sync-indicator" });
    const label = row.createSpan({ cls: "knowledge-forests-sync-label", text: this.syncProgress?.message ?? "Checking sync status…" });
    const track = panel.createDiv({ cls: "knowledge-forests-sync-track" });
    const fill = track.createDiv({ cls: "knowledge-forests-sync-fill" });
    if (this.syncProgress) {
      panel.addClass(`is-${this.syncProgress.phase}`);
      fill.style.width = `${Math.round(this.syncProgress.progress * 100)}%`;
    } else {
      track.hide();
      void this.plugin.git.status().then((status) => {
        if (!label.isConnected) return;
        if (status.conflicts > 0) {
          panel.addClass("is-conflict");
          label.setText(`${status.conflicts} sync conflict${status.conflicts === 1 ? "" : "s"}`);
          indicator.setAttribute("aria-label", "Conflict");
        } else if (this.plugin.remoteUpdatesAvailable) {
          panel.addClass("is-remote");
          label.setText("Remote updates available — sync before continuing");
        } else if (status.dirty) {
          panel.addClass("is-dirty");
          label.setText("Local changes");
        } else {
          panel.addClass("is-synced");
          label.setText("Synced");
        }
      }).catch((error: unknown) => {
        if (!label.isConnected) return;
        panel.addClass("is-error");
        label.setText(error instanceof Error ? error.message : String(error));
      });
    }
  }

  private renderTabs(root: HTMLElement): void {
    const tabs = root.createDiv({ cls: "knowledge-forests-tabs" });
    const definitions: Array<[ForestTab, string, string]> = [
      ["seeds", "sprout", "Seeds"],
      ["files", "files", "Files"],
      ["forests", "trees", "Forests"],
      ["activity", "calendar-range", "Activity"]
    ];
    for (const [tab, iconName, label] of definitions) {
      const button = tabs.createEl("button", { cls: tab === this.activeTab ? "is-active" : "" });
      const icon = button.createSpan();
      setIcon(icon, iconName);
      button.createSpan({ text: label });
      button.addEventListener("click", () => {
        this.activeTab = tab;
        void this.refresh();
      });
    }
  }

  private renderSeeds(container: HTMLElement): void {
    const { seeds } = this.plugin.index.getSnapshot();
    if (seeds.length === 0) {
      this.emptyState(container, "No seeds planted", "Use the sprout button to sow your first seed.");
      return;
    }
    const grid = container.createDiv({ cls: "knowledge-forests-plant-grid" });
    for (const seed of seeds) this.renderSeedCard(grid, seed, "seeds");
    if (this.highlightedSeedPath) {
      window.setTimeout(() => {
        const card = this.contentEl.querySelector<HTMLElement>(`[data-seed-path="${CSS.escape(this.highlightedSeedPath ?? "")}"]`);
        card?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
    }
  }

  private renderFiles(container: HTMLElement): void {
    const { files } = this.plugin.index.getSnapshot();
    const list = container.createDiv({ cls: "knowledge-forests-file-list" });
    for (const record of files) {
      const row = list.createDiv({ cls: "knowledge-forests-file-row" });
      row.tabIndex = 0;
      const fileIcon = row.createSpan();
      setIcon(fileIcon, "file-text");
      row.createSpan({ cls: "knowledge-forests-file-name", text: record.file.basename });
      const chips = row.createDiv({ cls: "knowledge-forests-chips" });
      for (const seed of record.seeds) chips.createSpan({ cls: "knowledge-forests-chip", text: seed.name });
      for (const unresolved of record.unresolvedSeeds) {
        const chip = chips.createSpan({ cls: "knowledge-forests-chip is-unresolved", text: unresolved });
        chip.setAttribute("aria-label", "This seed link cannot be resolved");
      }
      if (record.seeds.length === 0 && record.unresolvedSeeds.length === 0) {
        chips.createSpan({ cls: "knowledge-forests-unassigned", text: "unassigned" });
      }
      row.addEventListener("click", () => void this.app.workspace.getLeaf(false).openFile(record.file));
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const menu = new Menu();
        menu.addItem((item) => item.setTitle("Manage seeds").setIcon("sprout").onClick(() => this.plugin.openManageSeeds(record.file)));
        menu.showAtMouseEvent(event);
      });
    }
  }

  private renderForests(container: HTMLElement): void {
    const { forests, seeds } = this.plugin.index.getSnapshot();
    if (forests.length === 0) {
      this.emptyState(container, "No forests yet", "Create a forest, then drag or assign seeds into it.");
      return;
    }
    const assigned = new Set(forests.flatMap((forest) => forest.seeds.map((seed) => seed.file.path)));
    const unassigned = seeds.filter((seed) => !assigned.has(seed.file.path));
    const unassignedGroup = this.forestGroup(container, "Unassigned seeds", null, unassigned.length, true);
    for (const seed of unassigned) this.renderSeedCard(unassignedGroup, seed, "forests");
    if (unassigned.length === 0) unassignedGroup.createDiv({ cls: "knowledge-forests-drop-hint", text: "Drop a seed here to remove its forest classification" });
    for (const forest of forests) {
      const group = this.forestGroup(container, forest.name, forest.file.path, forest.seeds.length, false);
      for (const seed of forest.seeds) this.renderSeedCard(group, seed, "forests");
      if (forest.seeds.length === 0) group.createDiv({ cls: "knowledge-forests-drop-hint", text: "Drag a seed here to classify it" });
    }
  }

  private async renderActivity(container: HTMLElement): Promise<void> {
    this.renderActivityControls(container);
    container.addEventListener("wheel", (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      this.zoomActivity(event.deltaY < 0 ? -1 : 1);
    }, { passive: false });
    const loading = container.createDiv({ cls: "knowledge-forests-loading", text: "Reading Git history…" });
    try {
      const days = await this.plugin.git.contributions(this.plugin.settings.heatmapDays);
      loading.remove();
      this.renderHeatmap(container, days);
    } catch (error) {
      loading.setText(error instanceof Error ? error.message : String(error));
      loading.addClass("is-error");
    }
  }

  private renderActivityControls(container: HTMLElement): void {
    const controls = container.createDiv({ cls: "knowledge-forests-activity-controls" });
    const zoomOut = this.iconButton(controls, "zoom-out", "Show a longer period", () => this.zoomActivity(1));
    zoomOut.toggleAttribute("disabled", this.plugin.settings.heatmapDays === 365);
    controls.createSpan({ cls: "knowledge-forests-activity-range", text: `${this.plugin.settings.heatmapDays} days` });
    const zoomIn = this.iconButton(controls, "zoom-in", "Show a shorter period", () => this.zoomActivity(-1));
    zoomIn.toggleAttribute("disabled", this.plugin.settings.heatmapDays === 30);
    controls.createSpan({ cls: "knowledge-forests-zoom-hint", text: "Ctrl/⌘ + wheel to zoom" });
  }

  private zoomActivity(direction: -1 | 1): void {
    const now = Date.now();
    if (now - this.lastActivityZoomAt < 220) return;
    this.lastActivityZoomAt = now;
    const ranges = [30, 90, 180, 365];
    const exactIndex = ranges.indexOf(this.plugin.settings.heatmapDays);
    const nearestIndex = ranges.findIndex((days) => days >= this.plugin.settings.heatmapDays);
    const currentIndex = exactIndex >= 0 ? exactIndex : Math.max(0, nearestIndex);
    const next = ranges[Math.max(0, Math.min(ranges.length - 1, currentIndex + direction))];
    if (next !== undefined && next !== this.plugin.settings.heatmapDays) void this.plugin.setActivityRange(next);
  }

  private renderHeatmap(container: HTMLElement, days: ContributionDay[]): void {
    const summary = container.createDiv({ cls: "knowledge-forests-activity-summary" });
    const total = days.reduce((sum, day) => sum + day.count, 0);
    summary.createEl("strong", { text: `${total} contributions` });
    summary.createSpan({ text: ` in the last ${days.length} days` });
    const scroller = container.createDiv({ cls: "knowledge-forests-heatmap-scroll" });
    const heatmapBody = scroller.createDiv({ cls: "knowledge-forests-heatmap-body" });
    const maximum = Math.max(0, ...days.map((day) => day.count));
    const firstDate = new Date(`${days[0]?.date ?? "1970-01-01"}T12:00:00`);
    const padding = firstDate.getDay();
    const weeks = Math.ceil((padding + days.length) / 7);
    const months = heatmapBody.createDiv({ cls: "knowledge-forests-months" });
    months.style.gridTemplateColumns = `repeat(${weeks}, var(--kf-heatmap-cell))`;
    const monthStarts = new Map<number, string>();
    days.forEach((day, index) => {
      const date = new Date(`${day.date}T12:00:00`);
      const previous = index > 0 ? new Date(`${days[index - 1].date}T12:00:00`) : null;
      if (!previous || previous.getMonth() !== date.getMonth()) {
        monthStarts.set(Math.floor((padding + index) / 7), date.toLocaleDateString(undefined, { month: "short" }));
      }
    });
    for (const [week, label] of monthStarts) {
      const month = months.createSpan({ text: label });
      month.style.gridColumnStart = String(week + 1);
    }
    const heatmap = heatmapBody.createDiv({ cls: "knowledge-forests-heatmap" });
    for (let pad = 0; pad < firstDate.getDay(); pad += 1) heatmap.createDiv({ cls: "knowledge-forests-day is-padding" });
    for (const day of days) {
      const cell = heatmap.createDiv({ cls: `knowledge-forests-day level-${contributionLevel(day.count, maximum)}` });
      cell.setAttribute("aria-label", `${day.date}: ${day.count} contribution${day.count === 1 ? "" : "s"}`);
      cell.addEventListener("click", () => this.showCommits(day));
    }
    const fit = (): void => this.fitHeatmap(heatmapBody, weeks, scroller.clientWidth);
    this.heatmapResizeObserver?.disconnect();
    this.heatmapResizeObserver = new ResizeObserver(fit);
    this.heatmapResizeObserver.observe(scroller);
    window.setTimeout(fit, 0);
    const legend = container.createDiv({ cls: "knowledge-forests-legend" });
    legend.createSpan({ text: "Less" });
    for (let level = 0; level <= 4; level += 1) legend.createSpan({ cls: `knowledge-forests-day level-${level}` });
    legend.createSpan({ text: "More" });
  }

  private fitHeatmap(body: HTMLElement, weeks: number, availableWidth: number): void {
    if (weeks <= 0 || availableWidth <= 0) return;
    const minimumGap = weeks > 30 ? 1 : weeks > 16 ? 2 : 3;
    const size = Math.max(4, Math.min(24, Math.floor((availableWidth - minimumGap * (weeks - 1)) / weeks)));
    body.style.setProperty("--kf-heatmap-cell", `${size}px`);
    body.style.setProperty("--kf-heatmap-gap", `${minimumGap}px`);
  }

  private renderSeedCard(container: HTMLElement, seed: SeedRecord, mode: "seeds" | "forests"): void {
    const card = container.createDiv({
      cls: `knowledge-forests-seed-card${this.highlightedSeedPath === seed.file.path ? " is-highlighted" : ""}`,
      attr: { "data-seed-path": seed.file.path }
    });
    card.draggable = true;
    card.addEventListener("dragstart", (event) => event.dataTransfer?.setData("text/knowledge-forest-seed", seed.file.path));
    const visual = card.createDiv({ cls: "knowledge-forests-seed-visual" });
    this.renderer.render(seed, visual);
    visual.addEventListener("click", () => {
      if (mode === "forests") void this.focusSeed(seed);
      else void this.app.workspace.getLeaf(false).openFile(seed.file);
    });
    visual.addEventListener("contextmenu", (event) => this.showSeedMenu(event, seed));
    if (mode === "seeds") {
      const details = card.createEl("details", { cls: "knowledge-forests-seed-notes" });
      details.createEl("summary", { text: `${seed.noteFiles.length} note${seed.noteFiles.length === 1 ? "" : "s"}` });
      for (const file of seed.noteFiles) {
        const link = details.createEl("button", { text: file.basename });
        link.addEventListener("click", () => void this.app.workspace.getLeaf(false).openFile(file));
      }
    }
  }

  private forestGroup(
    container: HTMLElement,
    name: string,
    forestPath: string | null,
    count: number,
    unassigned: boolean
  ): HTMLElement {
    const section = container.createDiv({ cls: `knowledge-forests-forest${unassigned ? " is-unassigned" : ""}` });
    const heading = section.createDiv({ cls: "knowledge-forests-forest-heading" });
    heading.createEl("h3", { text: name });
    heading.createSpan({ cls: "knowledge-forests-forest-count", text: String(count) });
    const group = section.createDiv({ cls: "knowledge-forests-plant-grid" });
    group.addClass("is-drop-target");
    group.addEventListener("dragover", (event) => event.preventDefault());
    group.addEventListener("drop", (event) => {
      event.preventDefault();
      const seedPath = event.dataTransfer?.getData("text/knowledge-forest-seed");
      if (seedPath) void this.plugin.moveSeedToForest(seedPath, forestPath);
    });
    return group;
  }

  private async focusSeed(seed: SeedRecord): Promise<void> {
    this.highlightedSeedPath = seed.file.path;
    this.activeTab = "seeds";
    await this.refresh();
    window.setTimeout(() => {
      this.highlightedSeedPath = null;
      const card = this.contentEl.querySelector<HTMLElement>(`[data-seed-path="${CSS.escape(seed.file.path)}"]`);
      card?.removeClass("is-highlighted");
    }, 2600);
  }

  private showSeedMenu(event: MouseEvent, seed: SeedRecord): void {
    event.preventDefault();
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Open seed").setIcon("file-text").onClick(() => void this.app.workspace.getLeaf(false).openFile(seed.file)));
    for (const forest of this.plugin.index.getSnapshot().forests) {
      const included = forest.seeds.some((item) => item.file.path === seed.file.path);
      menu.addItem((item) => item
        .setTitle(`${included ? "Remove from" : "Add to"} ${forest.name}`)
        .setIcon(included ? "minus" : "plus")
        .onClick(() => void this.plugin.setSeedForest(seed.file, forest.file, !included)));
    }
    menu.showAtMouseEvent(event);
  }

  private showCommits(day: ContributionDay): void {
    if (day.commits.length === 0) {
      new Notice(`${day.date}: no contributions`);
      return;
    }
    const text = day.commits.map((commit) => `${commit.hash.slice(0, 7)} ${commit.subject}`).join("\n");
    new Notice(`${day.date}\n${text}`, 8000);
  }

  async startSync(): Promise<void> {
    if (this.syncRunning) return;
    this.syncRunning = true;
    this.setSyncProgress({ phase: "saving", message: "Starting sync…", progress: 0.05 });
    const button = this.contentEl.querySelector<HTMLElement>(".knowledge-forests-sync-button");
    button?.addClass("is-syncing");
    button?.toggleAttribute("disabled", true);
    try {
      let result = await this.plugin.git.sync((progress) => this.setSyncProgress(progress));
      if (result.status === "unrelated") {
        const confirmed = window.confirm(
          "This vault and the remote repository have separate Git histories. This usually happens when two devices initialized the same notes independently.\n\nMerge both histories and resolve any overlapping files? Before continuing, verify that the configured remote is the correct notes repository. Nothing has been uploaded yet."
        );
        if (!confirmed) {
          this.syncProgress = null;
          new Notice("Merge canceled; the local commit was kept and nothing was uploaded.");
          return;
        }
        result = await this.plugin.git.sync(
          (progress) => this.setSyncProgress(progress),
          { allowUnrelatedHistories: true }
        );
      }
      if (result.status === "conflict") {
        this.openConflictResolver(result.conflicts);
      } else {
        this.plugin.remoteUpdatesAvailable = false;
        new Notice(result.message);
      }
    } catch (error) {
      this.setSyncProgress({ phase: "error", message: error instanceof Error ? error.message : String(error), progress: 1 });
      new Notice(error instanceof Error ? error.message : String(error), 10000);
    } finally {
      this.syncRunning = false;
      await this.refresh();
    }
  }

  private setSyncProgress(progress: SyncProgress): void {
    this.syncProgress = progress;
    const panel = this.contentEl.querySelector<HTMLElement>(".knowledge-forests-sync-panel");
    if (!panel) return;
    panel.className = `knowledge-forests-sync-panel is-${progress.phase}`;
    panel.querySelector<HTMLElement>(".knowledge-forests-sync-label")?.setText(progress.message);
    const track = panel.querySelector<HTMLElement>(".knowledge-forests-sync-track");
    track?.show();
    const fill = panel.querySelector<HTMLElement>(".knowledge-forests-sync-fill");
    if (fill) fill.style.width = `${Math.round(progress.progress * 100)}%`;
  }

  private openConflictResolver(conflicts: GitConflict[]): void {
    new SyncConflictModal(
      this.app,
      conflicts,
      (conflict, resolution, content) => this.plugin.git.resolveConflict(conflict, resolution, content),
      () => this.plugin.git.getConflicts(),
      async () => {
        this.syncRunning = true;
        try {
          await this.plugin.git.completeConflictResolution((progress) => this.setSyncProgress(progress));
          this.plugin.remoteUpdatesAvailable = false;
          new Notice("Conflict resolved and synced");
        } finally {
          this.syncRunning = false;
          await this.refresh();
        }
      },
      async () => {
        await this.plugin.git.abortConflictResolution();
        this.syncProgress = null;
        await this.refresh();
      }
    ).open();
  }

  private async decorateSyncStatus(button: HTMLElement): Promise<void> {
    try {
      const status = await this.plugin.git.status();
      button.toggleClass("is-dirty", status.dirty);
      button.setAttribute("aria-label", status.repository
        ? `${status.dirty ? "Unsynced changes" : "Clean"}; ahead ${status.ahead}, behind ${status.behind}`
        : "Git is not initialized; Sync will initialize it");
    } catch (error) {
      button.addClass("is-error");
      button.setAttribute("aria-label", error instanceof Error ? error.message : String(error));
    }
  }

  private iconButton(container: HTMLElement, iconName: string, label: string, action: () => void): HTMLElement {
    const button = container.createEl("button", { cls: "clickable-icon" });
    setIcon(button, iconName);
    button.setAttribute("aria-label", label);
    button.addEventListener("click", action);
    return button;
  }

  private emptyState(container: HTMLElement, title: string, description: string): void {
    const empty = container.createDiv({ cls: "knowledge-forests-empty" });
    const icon = empty.createDiv();
    setIcon(icon, "sprout");
    empty.createEl("h3", { text: title });
    empty.createEl("p", { text: description });
  }
}
