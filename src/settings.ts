import { App, PluginSettingTab, Setting } from "obsidian";
import type KnowledgeForestsPlugin from "./main";
import { DEFAULT_THRESHOLDS } from "./model";
import { GITHUB_TOKEN_SECRET_ID, type KnowledgeForestsSettings } from "./types";

export const DEFAULT_SETTINGS: KnowledgeForestsSettings = {
  seedFolder: "Knowledge Forests/Seeds",
  forestFolder: "Knowledge Forests/Forests",
  templateFolder: "Templates",
  h1Weight: 1,
  h2Weight: 0.5,
  thresholds: DEFAULT_THRESHOLDS,
  gitRemoteUrl: "",
  gitAuthMode: "system",
  gitAuthorName: "",
  gitAuthorEmail: "",
  commitMessageTemplate: "forest sync: {{datetime}}",
  heatmapDays: 90
};

export class KnowledgeForestsSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: KnowledgeForestsPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Knowledge Forests" });

    this.textSetting("Seed folder", "Folder containing manually planted seeds.", "seedFolder");
    this.textSetting("Forest folder", "Folder containing forest records.", "forestFolder");
    this.textSetting("Template folder", "Notes in this folder do not contribute growth.", "templateFolder");

    containerEl.createEl("h3", { text: "Growth" });
    this.numberSetting("H1 weight", "Growth points contributed by each level-one heading.", "h1Weight", 0, 100, 0.5);
    this.numberSetting("H2 weight", "Growth points contributed by each level-two heading.", "h2Weight", 0, 100, 0.5);
    this.thresholdSetting("Sprout threshold", "sprout");
    this.thresholdSetting("Seedling threshold", "seedling");
    this.thresholdSetting("Young tree threshold", "youngTree");
    this.thresholdSetting("Mature tree threshold", "matureTree");

    containerEl.createEl("h3", { text: "Git sync" });
    this.textSetting("Remote URL", "Private GitHub repository SSH or HTTPS URL.", "gitRemoteUrl", "git@github.com:user/notes.git");
    new Setting(containerEl)
      .setName("Authentication")
      .setDesc("Use a GitHub token for HTTPS, or let system Git handle SSH and stored credentials.")
      .addDropdown((dropdown) => dropdown
        .addOption("github-token", "GitHub HTTPS token")
        .addOption("system", "System Git / SSH")
        .setValue(this.plugin.settings.gitAuthMode)
        .onChange(async (value) => {
          this.plugin.settings.gitAuthMode = value as KnowledgeForestsSettings["gitAuthMode"];
          await this.plugin.saveSettingsAndRefresh();
          this.display();
        }));
    if (this.plugin.settings.gitAuthMode === "github-token") this.tokenSetting();
    this.textSetting("Author name", "Name written to commits created by the Sync button.", "gitAuthorName");
    this.textSetting("Author email", "Must match an email associated with your GitHub account.", "gitAuthorEmail");
    this.textSetting("Commit message", "Use {{datetime}} to insert the local date and time.", "commitMessageTemplate");
    new Setting(containerEl)
      .setName("Activity range")
      .setDesc("Number of recent days displayed in the contribution heatmap.")
      .addDropdown((dropdown) => dropdown
        .addOption("30", "30 days")
        .addOption("90", "90 days")
        .addOption("180", "180 days")
        .addOption("365", "365 days")
        .setValue(String(this.plugin.settings.heatmapDays))
        .onChange(async (value) => {
          this.plugin.settings.heatmapDays = Number(value);
          await this.plugin.saveSettingsAndRefresh();
        }));
  }

  private tokenSetting(): void {
    const saved = this.app.secretStorage.getSecret(GITHUB_TOKEN_SECRET_ID);
    new Setting(this.containerEl)
      .setName("GitHub personal access token")
      .setDesc("Use a fine-grained token limited to this repository with Contents: Read and write. Stored in Obsidian SecretStorage, never in the Vault.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder(saved ? "Token saved — enter a new token to replace it" : "github_pat_…");
        text.onChange((value) => {
          const token = value.trim();
          if (token) this.app.secretStorage.setSecret(GITHUB_TOKEN_SECRET_ID, token);
        });
        return text;
      })
      .addButton((button) => button
        .setButtonText("Clear")
        .setDisabled(!saved)
        .onClick(() => {
          this.app.secretStorage.setSecret(GITHUB_TOKEN_SECRET_ID, "");
          this.display();
        }));
  }

  private textSetting(
    name: string,
    description: string,
    key: keyof Pick<KnowledgeForestsSettings, "seedFolder" | "forestFolder" | "templateFolder" | "gitRemoteUrl" | "gitAuthorName" | "gitAuthorEmail" | "commitMessageTemplate">,
    placeholder = ""
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => text
        .setPlaceholder(placeholder)
        .setValue(this.plugin.settings[key])
        .onChange(async (value) => {
          this.plugin.settings[key] = value.trim();
          await this.plugin.saveSettingsAndRefresh();
        }));
  }

  private numberSetting(
    name: string,
    description: string,
    key: "h1Weight" | "h2Weight",
    min: number,
    max: number,
    step: number
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = String(min);
        text.inputEl.max = String(max);
        text.inputEl.step = String(step);
        return text.setValue(String(this.plugin.settings[key])).onChange(async (value) => {
          const parsed = Number(value);
          if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
            this.plugin.settings[key] = parsed;
            await this.plugin.saveSettingsAndRefresh();
          }
        });
      });
  }

  private thresholdSetting(name: string, key: keyof KnowledgeForestsSettings["thresholds"]): void {
    new Setting(this.containerEl).setName(name).addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0";
      text.inputEl.step = "0.5";
      return text.setValue(String(this.plugin.settings.thresholds[key])).onChange(async (value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) {
          this.plugin.settings.thresholds[key] = parsed;
          await this.plugin.saveSettingsAndRefresh();
        }
      });
    });
  }
}
