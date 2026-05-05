import { Plugin, WorkspaceLeaf } from "obsidian";
import { ClaudeView, VIEW_TYPE_NEURALNOTES } from "./view";
import {
  NeuralNotesSettingTab,
  DEFAULT_SETTINGS,
  NeuralNotesSettings,
} from "./settings";

export default class NeuralNotesPlugin extends Plugin {
  settings: NeuralNotesSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_NEURALNOTES,
      (leaf: WorkspaceLeaf) => new ClaudeView(leaf, this),
    );

    this.addRibbonIcon("bot", "Open neural notes", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-pane",
      name: "Open pane",
      callback: () => void this.activateView(),
    });

    this.addSettingTab(new NeuralNotesSettingTab(this.app, this));
  }

  async activateView() {
    const { workspace } = this.app;

    const existing = workspace.getLeavesOfType(VIEW_TYPE_NEURALNOTES);
    if (existing.length > 0) {
      await workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_NEURALNOTES, active: true });
    await workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData(),
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
