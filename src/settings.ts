import { App, PluginSettingTab, Setting } from "obsidian";
import type NeuralNotesPlugin from "./main";

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan";

export interface NeuralNotesSettings {
  pathToClaudeBinary: string;
  permissionMode: PermissionMode;
  systemPromptAddendum: string;
  debugMode: boolean;
  restrictToVault: boolean;
  sendOnEnter: boolean;
}

export const DEFAULT_SETTINGS: NeuralNotesSettings = {
  pathToClaudeBinary: "",
  permissionMode: "acceptEdits",
  systemPromptAddendum: [
    "You are working inside an Obsidian vault. The working directory (cwd) is the vault root and notes are Markdown (.md) files within it.",
    "Always treat paths the user mentions as relative to cwd unless they are explicitly absolute. For example, if the user says 'CLAUDE.md', read 'CLAUDE.md' (or './CLAUDE.md'), NOT '/root/CLAUDE.md', '~/CLAUDE.md', or any other absolute path outside the vault.",
    "Never read paths under /root, /etc, /var, or the user's home directory unless the user explicitly provides such an absolute path.",
    "Before reading a specific file, if you are not certain it exists, use Glob or LS within cwd to discover what notes actually exist — never guess at filenames.",
    "Use [[wikilinks]] for cross-note references when helpful.",
    "If a Read returns 'File does not exist' on an iCloud-synced vault, the file may be a dataless `.icloud` placeholder; ask the user to open it once in Finder/Obsidian to trigger download.",
    "Be concise.",
  ].join(" "),
  debugMode: false,
  restrictToVault: true,
  sendOnEnter: false,
};

export class NeuralNotesSettingTab extends PluginSettingTab {
  plugin: NeuralNotesPlugin;

  constructor(app: App, plugin: NeuralNotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const intro = containerEl.createEl("p");
    intro.setText(
      "This plugin uses the Claude Agent SDK, which spawns the local `claude` CLI. " +
        "You must have Claude Code installed and signed in (`claude login`) for this plugin to work.",
    );

    new Setting(containerEl)
      .setName("Claude binary path")
      .setDesc(
        "Optional. Leave blank to use the `claude` binary on your PATH.",
      )
      .addText((text) =>
        text
          .setPlaceholder("/usr/local/bin/claude")
          .setValue(this.plugin.settings.pathToClaudeBinary)
          .onChange(async (value) => {
            this.plugin.settings.pathToClaudeBinary = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Permission mode")
      .setDesc(
        "Controls whether Claude can edit notes without asking. " +
          "`acceptEdits` lets Claude modify your notes directly.",
      )
      .addDropdown((dd) =>
        dd
          .addOption("default", "Default (prompt for edits)")
          .addOption("acceptEdits", "Accept edits (allow silently)")
          .addOption("plan", "Plan (read-only)")
          .addOption("bypassPermissions", "Bypass permissions (allow all)")
          .setValue(this.plugin.settings.permissionMode)
          .onChange(async (value) => {
            this.plugin.settings.permissionMode = value as PermissionMode;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Send on enter")
      .setDesc(
        "When on: enter sends the message and ⌘/Ctrl+Enter inserts a newline. " +
          "When off (default): enter inserts a newline and ⌘/Ctrl+Enter sends.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.sendOnEnter)
          .onChange(async (value) => {
            this.plugin.settings.sendOnEnter = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Restrict to vault")
      .setDesc(
        "Auto-deny any tool call that targets a file outside the vault, " +
          "with a message asking Claude to use a vault-relative path. " +
          "Stops the model from probing /root, /etc, ~, etc.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.restrictToVault)
          .onChange(async (value) => {
            this.plugin.settings.restrictToVault = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Debug mode")
      .setDesc(
        "Show tool input JSON and full tool error text inline in the chat. " +
          "Useful for diagnosing why Claude failed to read a file.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugMode)
          .onChange(async (value) => {
            this.plugin.settings.debugMode = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("System prompt addendum")
      .setDesc("Appended to the system prompt for every conversation.")
      .addTextArea((ta) => {
        ta.setValue(this.plugin.settings.systemPromptAddendum).onChange(
          async (value) => {
            this.plugin.settings.systemPromptAddendum = value;
            await this.plugin.saveSettings();
          },
        );
        ta.inputEl.rows = 4;
        ta.inputEl.addClass("neuralnotes-settings-textarea");
      });
  }
}
