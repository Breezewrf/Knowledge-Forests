import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type { GitConflict, SeedRecord } from "./types";

export class NameModal extends Modal {
  private value = "";

  constructor(
    app: App,
    private readonly titleText: string,
    private readonly actionText: string,
    private readonly onSubmit: (value: string) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.titleText);
    new Setting(this.contentEl)
      .setName("Name")
      .addText((text) => {
        text.inputEl.focus();
        text.onChange((value) => { this.value = value; });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") void this.submit();
        });
      });
    new Setting(this.contentEl).addButton((button) => button
      .setButtonText(this.actionText)
      .setCta()
      .onClick(() => void this.submit()));
  }

  private async submit(): Promise<void> {
    const value = this.value.trim();
    if (!value) return;
    await this.onSubmit(value);
    this.close();
  }
}

export class ManageSeedsModal extends Modal {
  private readonly selected = new Set<string>();

  constructor(
    app: App,
    private readonly file: TFile,
    private readonly seeds: SeedRecord[],
    currentSeedPaths: string[],
    private readonly onSave: (selectedPaths: string[]) => Promise<void>
  ) {
    super(app);
    for (const path of currentSeedPaths) this.selected.add(path);
  }

  onOpen(): void {
    this.titleEl.setText(`Manage seeds for ${this.file.basename}`);
    if (this.seeds.length === 0) {
      this.contentEl.createEl("p", { text: "No seeds exist yet. Use Sow seed first." });
      return;
    }
    const list = this.contentEl.createDiv({ cls: "knowledge-forests-seed-picker" });
    for (const seed of this.seeds) {
      new Setting(list).setName(seed.name).addToggle((toggle) => toggle
        .setValue(this.selected.has(seed.file.path))
        .onChange((value) => {
          if (value) this.selected.add(seed.file.path);
          else this.selected.delete(seed.file.path);
        }));
    }
    new Setting(this.contentEl).addButton((button) => button
      .setButtonText("Save")
      .setCta()
      .onClick(async () => {
        await this.onSave([...this.selected]);
        this.close();
      }));
  }
}

export class SyncConflictModal extends Modal {
  private conflicts: GitConflict[];
  private busy = false;

  constructor(
    app: App,
    conflicts: GitConflict[],
    private readonly onResolve: (conflict: GitConflict, resolution: "local" | "remote" | "manual", content?: string) => Promise<void>,
    private readonly onRefresh: () => Promise<GitConflict[]>,
    private readonly onComplete: () => Promise<void>,
    private readonly onAbort: () => Promise<void>
  ) {
    super(app);
    this.conflicts = conflicts;
  }

  onOpen(): void {
    this.modalEl.addClass("knowledge-forests-conflict-modal");
    this.render();
  }

  private render(): void {
    this.titleEl.setText("Resolve sync conflict");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "Another device changed the same content. Choose the current device version, the remote version, or edit a combined result. Nothing is uploaded until every conflict is resolved."
    });
    const summary = this.contentEl.createDiv({ cls: "knowledge-forests-conflict-summary" });
    summary.createEl("strong", { text: `${this.conflicts.length} file${this.conflicts.length === 1 ? "" : "s"} remaining` });
    for (const conflict of this.conflicts) this.renderConflict(conflict);

    const actions = this.contentEl.createDiv({ cls: "knowledge-forests-conflict-footer" });
    const abort = actions.createEl("button", { text: "Cancel merge" });
    abort.disabled = this.busy;
    abort.addEventListener("click", () => void this.abort());
    const finish = actions.createEl("button", { cls: "mod-cta", text: "Complete merge and upload" });
    finish.disabled = this.busy || this.conflicts.length > 0;
    finish.addEventListener("click", () => void this.complete());
  }

  private renderConflict(conflict: GitConflict): void {
    const section = this.contentEl.createDiv({ cls: "knowledge-forests-conflict-file" });
    section.createEl("h3", { text: conflict.path });
    if (conflict.binary) section.createDiv({ cls: "knowledge-forests-binary-warning", text: "Binary file — choose one complete version." });
    const comparison = section.createDiv({ cls: "knowledge-forests-conflict-comparison" });
    this.conflictSide(comparison, "Current device", conflict.localContent);
    this.conflictSide(comparison, "Remote", conflict.remoteContent);
    const actions = section.createDiv({ cls: "knowledge-forests-conflict-actions" });
    this.resolveButton(actions, "Keep current device", conflict, "local");
    this.resolveButton(actions, "Keep remote", conflict, "remote");
    if (!conflict.binary) {
      const manual = actions.createEl("button", { text: "Merge manually" });
      manual.disabled = this.busy;
      manual.addEventListener("click", () => {
        const editor = section.querySelector<HTMLElement>(".knowledge-forests-manual-merge");
        editor?.toggleClass("is-visible", !editor.hasClass("is-visible"));
      });
      const manualArea = section.createDiv({ cls: "knowledge-forests-manual-merge" });
      const textarea = manualArea.createEl("textarea");
      textarea.value = conflict.workingContent ?? conflict.localContent ?? conflict.remoteContent ?? "";
      const save = manualArea.createEl("button", { cls: "mod-cta", text: "Use edited result" });
      save.addEventListener("click", () => void this.resolve(conflict, "manual", textarea.value));
    }
  }

  private conflictSide(container: HTMLElement, title: string, content: string | null): void {
    const side = container.createDiv({ cls: "knowledge-forests-conflict-side" });
    side.createEl("h4", { text: title });
    if (content === null) {
      side.createDiv({ cls: "knowledge-forests-deleted", text: "File deleted" });
      return;
    }
    const preview = side.createEl("textarea");
    preview.readOnly = true;
    preview.value = content.slice(0, 20_000);
  }

  private resolveButton(
    container: HTMLElement,
    label: string,
    conflict: GitConflict,
    resolution: "local" | "remote"
  ): void {
    const button = container.createEl("button", { text: label });
    button.disabled = this.busy;
    button.addEventListener("click", () => void this.resolve(conflict, resolution));
  }

  private async resolve(conflict: GitConflict, resolution: "local" | "remote" | "manual", content?: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.onResolve(conflict, resolution, content);
      this.conflicts = await this.onRefresh();
      this.render();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 8000);
      this.busy = false;
      this.render();
    }
  }

  private async complete(): Promise<void> {
    if (this.busy || this.conflicts.length > 0) return;
    this.busy = true;
    this.render();
    try {
      await this.onComplete();
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 8000);
      this.busy = false;
      this.render();
    }
  }

  private async abort(): Promise<void> {
    if (this.busy || !window.confirm("Cancel this merge? Your local commit will be kept, but conflict choices made in this window will be discarded.")) return;
    this.busy = true;
    try {
      await this.onAbort();
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 8000);
      this.busy = false;
      this.render();
    }
  }
}
