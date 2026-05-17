import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type CosmosPlugin from "./main";
import { CosmosClient } from "./cosmos-client";

export interface CosmosSettings {
  apiBase: string;
  mcpKey: string;
  polarityUserId: string;
  syncOnSave: boolean;
  syncIntervalMinutes: number;
  lastSyncedAt: string | null;
  syncedFiles: Record<string, { hash: string; syncedAt: string }>;
  // Watermark for the bulk-walk path (syncAll, plugin-load catch-up).
  // Newest file mtime (epoch ms) covered by a prior successful walk.
  // Files with mtime <= watermark are skipped before we even hash them,
  // so a re-walk on an unchanged 50k-note vault returns in milliseconds
  // instead of reading every file off disk. Live `vault.on('modify')`
  // saves bypass this entirely — they always sync.
  lastIncrementalMtimeMs: number;
}

export const DEFAULT_SETTINGS: CosmosSettings = {
  apiBase: "https://cosmos.polarity-lab.com",
  mcpKey: "",
  polarityUserId: "",
  syncOnSave: false,
  syncIntervalMinutes: 0,
  lastSyncedAt: null,
  syncedFiles: {},
  lastIncrementalMtimeMs: 0,
};

export class CosmosSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: CosmosPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Cosmos" });
    containerEl.createEl("p", {
      text: "Point your vault at the Cosmos exocortex. Nothing leaves the device except the deltas.",
    });

    new Setting(containerEl)
      .setName("API base")
      .setDesc("The Cosmos host this plugin talks to.")
      .addText((text) =>
        text
          .setPlaceholder("https://cosmos.polarity-lab.com")
          .setValue(this.plugin.settings.apiBase)
          .onChange(async (value) => {
            this.plugin.settings.apiBase = value.trim() || DEFAULT_SETTINGS.apiBase;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("MCP key")
      .setDesc("Mint one at cosmos.polarity-lab.com under account settings. Starts with pmk_.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("pmk_...")
          .setValue(this.plugin.settings.mcpKey)
          .onChange(async (value) => {
            this.plugin.settings.mcpKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Probe whoami and confirm the key is bound to a user.")
      .addButton((btn) =>
        btn.setButtonText("Test").onClick(async () => {
          if (!this.plugin.settings.mcpKey) {
            new Notice("Add an MCP key first.");
            return;
          }
          btn.setDisabled(true);
          btn.setButtonText("Testing...");
          try {
            const client = new CosmosClient(this.plugin.settings);
            const res = await client.whoami();
            this.plugin.settings.polarityUserId = res.polarity_user_id;
            await this.plugin.saveSettings();
            new Notice(`Connected. polarity_user_id = ${res.polarity_user_id}`);
            this.display();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            new Notice(`Connection failed. ${msg}`);
          } finally {
            btn.setDisabled(false);
            btn.setButtonText("Test");
          }
        }),
      );

    if (this.plugin.settings.polarityUserId) {
      new Setting(containerEl)
        .setName("Bound user")
        .setDesc(this.plugin.settings.polarityUserId);
    }

    new Setting(containerEl)
      .setName("Sync on save")
      .setDesc("Push a note to Cosmos shortly after you save it.")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.syncOnSave).onChange(async (value) => {
          this.plugin.settings.syncOnSave = value;
          await this.plugin.saveSettings();
          this.plugin.refreshTimers();
        }),
      );

    new Setting(containerEl)
      .setName("Sync interval")
      .setDesc("Minutes between full vault sweeps. Zero turns the timer off.")
      .addSlider((sl) =>
        sl
          .setLimits(0, 240, 5)
          .setValue(this.plugin.settings.syncIntervalMinutes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.syncIntervalMinutes = value;
            await this.plugin.saveSettings();
            this.plugin.refreshTimers();
          }),
      );

    if (this.plugin.settings.lastSyncedAt) {
      new Setting(containerEl)
        .setName("Last sync")
        .setDesc(this.plugin.settings.lastSyncedAt);
    }
  }
}
