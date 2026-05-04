import { Plugin, WorkspaceLeaf } from "obsidian";
import { ClaudeView, VIEW_TYPE_CLAUDE } from "./view";
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
      VIEW_TYPE_CLAUDE,
      (leaf: WorkspaceLeaf) => new ClaudeView(leaf, this),
    );

    this.addRibbonIcon("bot", "NeuralNotes", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-neuralnotes-pane",
      name: "Open NeuralNotes pane",
      callback: () => void this.activateView(),
    });

    this.addSettingTab(new NeuralNotesSettingTab(this.app, this));
  }

  async activateView() {
    const { workspace } = this.app;

    const existing = workspace.getLeavesOfType(VIEW_TYPE_CLAUDE);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_CLAUDE, active: true });
    workspace.revealLeaf(leaf);
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
