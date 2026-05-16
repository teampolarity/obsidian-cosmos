import { Plugin, TFile, debounce } from "obsidian";
import { CosmosSettingTab, DEFAULT_SETTINGS, type CosmosSettings } from "./settings";
import { syncAll, syncOne } from "./sync";

export default class CosmosPlugin extends Plugin {
  settings!: CosmosSettings;
  private intervalHandle: number | null = null;
  private debouncedSaveSync: ((file: TFile) => void) | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new CosmosSettingTab(this.app, this));

    this.addRibbonIcon("orbit", "Sync vault to Cosmos", async () => {
      await syncAll(this);
    });

    this.addCommand({
      id: "cosmos-sync-vault",
      name: "Sync vault to Cosmos",
      callback: async () => {
        await syncAll(this);
      },
    });

    this.addCommand({
      id: "cosmos-sync-current",
      name: "Sync current note to Cosmos",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) {
          void syncOne(this, file);
        }
        return true;
      },
    });

    this.debouncedSaveSync = debounce(
      (file: TFile) => {
        void syncOne(this, file);
      },
      2000,
      true,
    );

    this.registerEvent(
      this.app.vault.on("modify", (af) => {
        if (!this.settings.syncOnSave) return;
        if (!(af instanceof TFile) || af.extension !== "md") return;
        this.debouncedSaveSync?.(af);
      }),
    );

    this.refreshTimers();
  }

  onunload(): void {
    if (this.intervalHandle != null) {
      window.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  refreshTimers(): void {
    if (this.intervalHandle != null) {
      window.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    const minutes = this.settings.syncIntervalMinutes;
    if (minutes > 0) {
      const ms = minutes * 60 * 1000;
      this.intervalHandle = window.setInterval(() => {
        void syncAll(this);
      }, ms);
      this.registerInterval(this.intervalHandle);
    }
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<CosmosSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
    if (!this.settings.syncedFiles) this.settings.syncedFiles = {};
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
