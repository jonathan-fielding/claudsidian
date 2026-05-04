import {
  ItemView,
  Notice,
  WorkspaceLeaf,
  MarkdownRenderer,
  Component,
  setIcon,
  FileSystemAdapter,
  TFile,
} from "obsidian";
import * as path from "path";
import * as fs from "fs";
import type NeuralNotesPlugin from "./main";
import {
  runClaudeQuery,
  ClaudeEvent,
  PermissionRequest,
  PermissionResponse,
} from "./claude";

export const VIEW_TYPE_CLAUDE = "neuralnotes-view";

export class ClaudeView extends ItemView {
  private plugin: NeuralNotesPlugin;
  private messagesEl!: HTMLDivElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private statusEl!: HTMLDivElement;
  private currentAbort: AbortController | null = null;
  private sessionId: string | undefined;
  private renderComponent = new Component();
  private sessionAllowedTools = new Set<string>();
  private pendingPermissions = 0;
  private currentBubble: AssistantBubbleHandle | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NeuralNotesPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDE;
  }

  getDisplayText(): string {
    return "NeuralNotes";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("neuralnotes-view");

    this.messagesEl = root.createDiv({ cls: "neuralnotes-messages" });

    this.statusEl = root.createDiv({ cls: "neuralnotes-status" });
    this.statusEl.setText("");

    const inputRow = root.createDiv({ cls: "neuralnotes-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "neuralnotes-input",
      attr: { placeholder: "Ask Claude about your notes…", rows: "3" },
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      if (e.isComposing) return;
      const hasMod = e.metaKey || e.ctrlKey;
      const hasShift = e.shiftKey;
      const sendOnEnter = this.plugin.settings.sendOnEnter;

      if (sendOnEnter) {
        if (hasMod || hasShift) {
          e.preventDefault();
          this.insertNewlineAtCursor();
        } else {
          e.preventDefault();
          void this.handleSend();
        }
      } else {
        if (hasMod) {
          e.preventDefault();
          void this.handleSend();
        }
      }
    });

    const buttons = inputRow.createDiv({ cls: "neuralnotes-buttons" });
    this.sendBtn = buttons.createEl("button", {
      text: "Send",
      cls: "mod-cta neuralnotes-send",
    });
    this.sendBtn.addEventListener("click", () => void this.handleSend());

    this.stopBtn = buttons.createEl("button", {
      text: "Stop",
      cls: "neuralnotes-stop",
    });
    this.stopBtn.disabled = true;
    this.stopBtn.addEventListener("click", () => this.handleStop());

    const newBtn = buttons.createEl("button", {
      text: "New chat",
      cls: "neuralnotes-new",
    });
    newBtn.addEventListener("click", () => this.resetConversation());

    this.appendSystemMessage(
      "NeuralNotes ready. Type a question and press Send (⌘/Ctrl+Enter).",
    );

    void this.maybeOfferSessionProtocol();
  }

  async onClose() {
    this.currentAbort?.abort();
    this.renderComponent.unload();
  }

  private resetConversation() {
    this.sessionId = undefined;
    this.sessionAllowedTools.clear();
    this.messagesEl.empty();
    this.appendSystemMessage("Started a new conversation.");
    void this.maybeOfferSessionProtocol();
  }

  private async maybeOfferSessionProtocol() {
    const file = this.app.vault.getAbstractFileByPath("CLAUDE.md");
    if (!(file instanceof TFile)) {
      this.appendCreateClaudeMdBubble();
      return;
    }
    const content = await this.app.vault.cachedRead(file);
    const startPatterns = [
      /start\s+(?:each|every|of\s+(?:each|every|the))\s+session/i,
      /(?:^|\n)\s*#+\s*session\s+start/i,
      /on\s+session\s+start/i,
      /at\s+session\s+start/i,
      /session\s+protocol[\s\S]{0,500}?start\s+each\s+session/i,
    ];
    if (!startPatterns.some((p) => p.test(content))) return;
    this.appendSessionPromptBubble();
  }

  private appendCreateClaudeMdBubble() {
    const el = this.messagesEl.createDiv({
      cls: "neuralnotes-msg neuralnotes-msg-session-prompt",
    });
    el.createDiv({
      cls: "neuralnotes-msg-role",
      text: "Set up NeuralNotes",
    });
    el.createDiv({
      cls: "neuralnotes-msg-body",
      text:
        "No CLAUDE.md found in your vault. CLAUDE.md tells Claude about " +
        "your vault structure, writing style, and how to start each session. " +
        "Want help creating one together?",
    });
    const buttons = el.createDiv({ cls: "neuralnotes-perm-buttons" });

    const setupBtn = buttons.createEl("button", {
      text: "Set it up",
      cls: "mod-cta",
    });
    setupBtn.addEventListener("click", () => {
      el.remove();
      const displayPrompt =
        "Help me set up a CLAUDE.md for my vault.";
      const actualPrompt = [
        "The user has no CLAUDE.md file in their Obsidian vault yet. Help them create one through a guided, interactive conversation.",
        "",
        "CLAUDE.md is an agent-instructions file written at the vault root. A good one covers:",
        "- Who the user is (name, role, preferred form of address)",
        "- The structure of their vault — what each top-level folder contains and any naming conventions",
        "- Their writing style preferences (tone, length, frontmatter, wikilinks, etc.)",
        "- A session protocol — what you should do at the start and end of each session",
        "",
        "Process:",
        "1. First, get the lay of the land yourself: use Glob with pattern '*' (or LS) to discover top-level folders, and Glob '*.md' for root-level notes. Do NOT ask the user about folders that don't exist.",
        "2. Greet them briefly (one short sentence) and explain you'll ask a small number of questions, then draft CLAUDE.md together.",
        "3. After the greeting, ask exactly ONE question per message. Topics to cover, in order:",
        "   a. Their name and preferred form of address.",
        "   b. What they primarily use the vault for.",
        "   c. Each top-level folder you discovered (one folder per question — what goes there and any conventions).",
        "   d. Writing style preferences.",
        "   e. Session-start protocol — what should you do at the start of each session.",
        "   f. Session-end protocol — what should you do at the end of each session.",
        "4. Once you have enough, propose a complete CLAUDE.md as a fenced markdown code block (```markdown ... ```) for the user to review. Sections: 'About Me', 'Vault Structure', 'Writing Style', 'Session Protocol'.",
        "5. If they approve, Write it to 'CLAUDE.md' (vault root, relative path). If they want changes, iterate before writing.",
        "",
        "QUESTION FORMAT (mandatory):",
        "- Ask exactly ONE question per message. End the message immediately after the question. Never include a follow-up question. Never list multiple questions in one message even as bullets.",
        "- Keep each message short — at most one or two short paragraphs of context, then the single question.",
        "- After the question, on a new line, append a quick-reply suggestions marker so the user can click an answer instead of typing. Format exactly:",
        '  <<<SUGGESTIONS:["Answer 1","Answer 2","Answer 3"]>>>',
        "- The suggestions must be a JSON array of 2–5 short strings (each ≤ 60 characters). They should be plausible answers tailored to the question. The user can also ignore them and type their own answer.",
        "- Do NOT include a suggestions marker for free-form questions where canned answers would be unhelpful (e.g. 'what is your name?'); in that case omit the marker.",
        "",
        "Use natural, conversational prose. Do NOT apply the strict bullet-list output format from the session-start protocol.",
      ].join("\n");
      void this.handleSend({ displayPrompt, actualPrompt });
    });

    const skipBtn = buttons.createEl("button", { text: "Skip" });
    skipBtn.addEventListener("click", () => el.remove());

    this.scrollToBottom();
  }

  private appendSessionPromptBubble() {
    const el = this.messagesEl.createDiv({
      cls: "neuralnotes-msg neuralnotes-msg-session-prompt",
    });
    el.createDiv({
      cls: "neuralnotes-msg-role",
      text: "Session start",
    });
    el.createDiv({
      cls: "neuralnotes-msg-body",
      text:
        "Your CLAUDE.md defines a session-start protocol. " +
        "Would you like Claude to run it now?",
    });
    const buttons = el.createDiv({ cls: "neuralnotes-perm-buttons" });

    const runBtn = buttons.createEl("button", {
      text: "Run protocol",
      cls: "mod-cta",
    });
    runBtn.addEventListener("click", () => {
      el.remove();
      const displayPrompt = "Run the session-start protocol from CLAUDE.md.";
      const actualPrompt = [
        "Please follow the session-start protocol defined in CLAUDE.md to begin this session.",
        "",
        "Output formatting rules (these are mandatory — follow exactly):",
        "1. Your entire response MUST be a single bullet list. The very first character of your response must be `*`. Do not write any prose, intro, acknowledgement, or summary outside the list.",
        "2. Output one top-level bullet per protocol step as you start it: `* Step N — <name>`. Stream the bullet at the moment you begin that step, before doing the work.",
        "3. Under each step, write findings as nested bullets (indented two spaces) starting with `- `. Each finding gets its own bullet. No multi-sentence paragraphs.",
        "4. Never use markdown headings (`#`, `##`, `###`) — bullets only.",
        "5. Every bullet MUST start on its own line. Emit a newline character before every `* ` and `- `.",
        "6. After the last step, finish with one bullet `* Summary` and nested `- ` bullets describing the overall outcome. Do not write closing prose.",
      ].join("\n");
      void this.handleSend({ displayPrompt, actualPrompt });
    });

    const skipBtn = buttons.createEl("button", { text: "Skip" });
    skipBtn.addEventListener("click", () => el.remove());

    this.scrollToBottom();
  }

  private permissionKey(req: PermissionRequest): string {
    if (req.input && typeof req.input === "object") {
      const obj = req.input as Record<string, unknown>;
      const target =
        obj.file_path ?? obj.path ?? obj.pattern ?? obj.command ?? "";
      return `${req.tool}::${String(target)}`;
    }
    return req.tool;
  }

  private requestPermission(req: PermissionRequest): Promise<PermissionResponse> {
    const key = this.permissionKey(req);
    const inputAsRecord =
      req.input && typeof req.input === "object"
        ? (req.input as Record<string, unknown>)
        : {};
    if (this.sessionAllowedTools.has(key) || this.sessionAllowedTools.has(req.tool)) {
      return Promise.resolve({ behavior: "allow", updatedInput: inputAsRecord });
    }
    const target = this.permissionTarget(req.input);
    const dirMisuse = this.findDirectoryMisuse(req);
    if (dirMisuse) {
      this.currentBubble?.addPermissionLog(req.tool, target, "deny", "once");
      return Promise.resolve({
        behavior: "deny",
        message:
          `Auto-denied: '${dirMisuse.path}' is a directory, not a file. ` +
          `The ${req.tool} tool only operates on files. ` +
          `To list directory contents, use Glob (e.g. pattern '${dirMisuse.path}/**/*.md') or LS instead.`,
      });
    }
    const missingParam = this.findMissingRequiredParam(req);
    if (missingParam) {
      this.currentBubble?.addPermissionLog(req.tool, null, "deny", "once");
      return Promise.resolve({
        behavior: "deny",
        message:
          `Auto-denied: the tool call to ${req.tool} is missing the required '${missingParam}' parameter. ` +
          `Retry the call with all required parameters populated.`,
      });
    }
    if (
      this.plugin.settings.restrictToVault &&
      target &&
      this.isPathOutsideVault(target)
    ) {
      const vaultPath = this.getVaultBasePath();
      this.currentBubble?.addPermissionLog(req.tool, target, "deny", "once");
      return Promise.resolve({
        behavior: "deny",
        message:
          `Auto-denied: that path is outside the user's Obsidian vault. ` +
          `The vault (your cwd) is: ${vaultPath}. ` +
          `Retry using a path relative to cwd, e.g. "CLAUDE.md" or "Folder/Note.md". ` +
          `Do NOT use absolute paths or paths under /root, /Users/<other>, /home, /etc, or ~.`,
      });
    }
    this.pendingPermissions += 1;
    this.refreshStatus();
    return new Promise((resolve) => {
      this.appendPermissionBubble(req, (decision, scope, bubbleEl) => {
        this.pendingPermissions = Math.max(0, this.pendingPermissions - 1);
        this.refreshStatus();
        bubbleEl.remove();
        this.currentBubble?.addPermissionLog(req.tool, target, decision, scope);
        if (decision === "allow") {
          if (scope === "tool") this.sessionAllowedTools.add(req.tool);
          else if (scope === "target") this.sessionAllowedTools.add(key);
          resolve({ behavior: "allow", updatedInput: inputAsRecord });
        } else {
          resolve({ behavior: "deny", message: "User denied permission." });
        }
      });
    });
  }

  private appendPermissionBubble(
    req: PermissionRequest,
    resolve: (
      decision: "allow" | "deny",
      scope: "once" | "target" | "tool",
      bubbleEl: HTMLElement,
    ) => void,
  ) {
    const el = this.messagesEl.createDiv({
      cls: "neuralnotes-msg neuralnotes-msg-permission",
    });

    el.createDiv({
      cls: "neuralnotes-msg-role",
      text: "Permission required",
    });

    const summary = el.createDiv({ cls: "neuralnotes-perm-summary" });
    summary.createSpan({
      cls: "neuralnotes-perm-tool",
      text: req.tool,
    });
    const target = this.permissionTarget(req.input);
    if (target) {
      summary.createSpan({ cls: "neuralnotes-perm-target", text: target });
    }

    const details = el.createEl("details", { cls: "neuralnotes-perm-details" });
    details.createEl("summary", { text: "Show input" });
    details.createEl("pre", { text: JSON.stringify(req.input, null, 2) });

    const buttons = el.createDiv({ cls: "neuralnotes-perm-buttons" });

    const finalize = (
      decision: "allow" | "deny",
      scope: "once" | "target" | "tool",
    ) => {
      resolve(decision, scope, el);
    };

    const allowOnce = buttons.createEl("button", {
      text: "Allow once",
      cls: "mod-cta",
    });
    allowOnce.addEventListener("click", () => finalize("allow", "once"));

    if (target) {
      const allowTarget = buttons.createEl("button", {
        text: "Allow this target",
      });
      allowTarget.addEventListener("click", () => finalize("allow", "target"));
    }

    const allowAll = buttons.createEl("button", {
      text: `Always allow ${req.tool}`,
    });
    allowAll.addEventListener("click", () => finalize("allow", "tool"));

    const deny = buttons.createEl("button", {
      text: "Deny",
      cls: "mod-warning",
    });
    deny.addEventListener("click", () => finalize("deny", "once"));

    this.scrollToBottom();
  }

  private findDirectoryMisuse(
    req: PermissionRequest,
  ): { path: string } | null {
    if (req.tool !== "Read" && req.tool !== "Edit" && req.tool !== "Write")
      return null;
    if (!req.input || typeof req.input !== "object") return null;
    const filePath = (req.input as Record<string, unknown>).file_path;
    if (typeof filePath !== "string" || !filePath) return null;
    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.getVaultBasePath(), filePath);
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) return { path: filePath };
    } catch {
      // file doesn't exist (or no perms); not a directory misuse, let
      // the tool itself error so we don't shadow real not-found cases.
    }
    return null;
  }

  private findMissingRequiredParam(req: PermissionRequest): string | null {
    const required: Record<string, string[]> = {
      Read: ["file_path"],
      Edit: ["file_path", "old_string", "new_string"],
      Write: ["file_path", "content"],
      Glob: ["pattern"],
      Grep: ["pattern"],
      Bash: ["command"],
    };
    const params = required[req.tool];
    if (!params) return null;
    const input =
      req.input && typeof req.input === "object"
        ? (req.input as Record<string, unknown>)
        : {};
    for (const p of params) {
      const v = input[p];
      if (v === undefined || v === null || v === "") return p;
    }
    return null;
  }

  private getVaultBasePath(): string {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
  }

  private isPathOutsideVault(target: string): boolean {
    const vault = this.getVaultBasePath();
    if (!vault) return false;
    if (target.startsWith("~")) return true;
    if (!path.isAbsolute(target)) return false;
    const normalized = path.resolve(target);
    const normalizedVault = path.resolve(vault);
    if (normalized === normalizedVault) return false;
    return !normalized.startsWith(normalizedVault + path.sep);
  }

  private permissionTarget(input: unknown): string | null {
    if (input && typeof input === "object") {
      const obj = input as Record<string, unknown>;
      const target = obj.file_path ?? obj.path ?? obj.pattern ?? obj.command;
      if (typeof target === "string") return target;
    }
    return null;
  }

  private handleStop() {
    this.currentAbort?.abort();
  }

  private insertNewlineAtCursor() {
    const ta = this.inputEl;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, start) + "\n" + ta.value.slice(end);
    const caret = start + 1;
    ta.selectionStart = caret;
    ta.selectionEnd = caret;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  private async handleSend(opts?: {
    displayPrompt?: string;
    actualPrompt?: string;
  }) {
    const inputValue = this.inputEl.value.trim();
    const displayPrompt = opts?.displayPrompt ?? inputValue;
    const actualPrompt = opts?.actualPrompt ?? inputValue;
    if (!actualPrompt) return;
    if (this.currentAbort) {
      new Notice("Claude is already responding. Press Stop first.");
      return;
    }

    if (!opts) this.inputEl.value = "";
    if (displayPrompt) this.appendUserMessage(displayPrompt);

    const buffer = { value: "" };
    const bubble = this.appendAssistantBubble(() => buffer.value);
    const assistantBubble = bubble.body;
    this.currentBubble = bubble;

    this.setBusy(true);
    const abort = new AbortController();
    this.currentAbort = abort;

    try {
      const newSession = await runClaudeQuery(this.plugin, {
        prompt: actualPrompt,
        resumeSessionId: this.sessionId,
        signal: abort.signal,
        canUseTool: (req) => this.requestPermission(req),
        onEvent: (event: ClaudeEvent) => {
          if (event.kind === "system" && event.sessionId) {
            this.sessionId = event.sessionId;
          } else if (event.kind === "assistant-text" && event.text) {
            buffer.value += event.text;
            void this.renderMarkdown(assistantBubble, buffer.value);
          } else if (event.kind === "tool-use") {
            bubble.addThinkingItem(
              event.tool ?? "tool",
              event.toolInput,
              event.toolUseId,
            );
          } else if (event.kind === "tool-result") {
            const handled = bubble.setThinkingResult(
              event.toolUseId,
              event.isError ?? false,
              event.text ?? "",
            );
            if (!handled && event.isError) {
              this.appendToolError(event.text ?? "(error)");
            }
          } else if (event.kind === "result") {
            if (event.sessionId) this.sessionId = event.sessionId;
            if (event.isError && event.text) {
              this.appendErrorMessage(event.text);
            }
          }
        },
      });
      if (newSession) this.sessionId = newSession;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.appendErrorMessage(`Error: ${msg}`);
      console.error("NeuralNotes error:", err);
    } finally {
      this.currentAbort = null;
      this.setBusy(false);
      bubble.finalize();
      this.currentBubble = null;
    }
  }

  private busy = false;

  private setBusy(busy: boolean) {
    this.busy = busy;
    this.sendBtn.disabled = busy;
    this.stopBtn.disabled = !busy;
    if (!busy) this.pendingPermissions = 0;
    this.refreshStatus();
  }

  private refreshStatus() {
    const root = this.containerEl.children[1] as HTMLElement | undefined;
    if (this.pendingPermissions > 0 && this.busy) {
      root?.addClass("is-awaiting-permission");
    } else {
      root?.removeClass("is-awaiting-permission");
    }
    if (!this.busy) {
      this.statusEl.setText("");
      return;
    }
    if (this.pendingPermissions > 0) {
      const label =
        this.pendingPermissions === 1
          ? "Waiting for your permission…"
          : `Waiting for your permission (${this.pendingPermissions})…`;
      this.statusEl.setText(label);
    } else {
      this.statusEl.setText("");
    }
  }

  private appendUserMessage(text: string) {
    const el = this.messagesEl.createDiv({
      cls: "neuralnotes-msg neuralnotes-msg-user",
    });
    el.createDiv({ cls: "neuralnotes-msg-role", text: "You" });
    el.createDiv({ cls: "neuralnotes-msg-body", text });
    this.addCopyButton(el, () => text);
    this.scrollToBottom();
  }

  private appendAssistantBubble(getText: () => string): AssistantBubbleHandle {
    const el = this.messagesEl.createDiv({
      cls: "neuralnotes-msg neuralnotes-msg-assistant",
    });
    el.createDiv({ cls: "neuralnotes-msg-role", text: "Claude" });

    const thinking = el.createEl("details", {
      cls: "neuralnotes-thinking",
    });
    thinking.style.display = "none";
    const thinkingSummary = thinking.createEl("summary");
    const thinkingLabel = thinkingSummary.createSpan({
      cls: "neuralnotes-thinking-label",
      text: "Claude's thoughts",
    });
    const thinkingCount = thinkingSummary.createSpan({
      cls: "neuralnotes-thinking-count",
    });
    const thinkingList = thinking.createDiv({
      cls: "neuralnotes-thinking-list",
    });

    const body = el.createDiv({
      cls: "neuralnotes-msg-body neuralnotes-placeholder",
    });
    const placeholderWord = randomThinkingWord();
    body.setText(placeholderWord + "…");

    const suggestionsEl = el.createDiv({
      cls: "neuralnotes-suggestions",
    });
    suggestionsEl.style.display = "none";

    this.addCopyButton(el, getText);
    this.scrollToBottom();

    let count = 0;
    let bodyHasContent = false;
    const rowsById = new Map<string, HTMLDivElement>();
    const observer = new MutationObserver(() => {
      if (body.childNodes.length > 0 && body.textContent?.trim() !== placeholderWord + "…") {
        body.removeClass("neuralnotes-placeholder");
        bodyHasContent = true;
      }
    });
    observer.observe(body, { childList: true, subtree: true, characterData: true });

    return {
      body,
      addThinkingItem: (name, input, id) => {
        thinking.style.display = "";
        count += 1;
        thinkingCount.setText(` (${count})`);
        const debug = this.plugin.settings.debugMode;
        const row = thinkingList.createDiv({
          cls: "neuralnotes-thinking-row",
        });

        let head: HTMLElement;
        if (debug) {
          const headDetails = row.createEl("details", {
            cls: "neuralnotes-thinking-head-details",
          });
          head = headDetails.createEl("summary", {
            cls: "neuralnotes-thinking-head",
          });
          const inputPre = headDetails.createEl("pre", {
            cls: "neuralnotes-thinking-input",
          });
          inputPre.setText(JSON.stringify(input, null, 2));
        } else {
          head = row.createDiv({ cls: "neuralnotes-thinking-head" });
        }

        head.createSpan({ cls: "neuralnotes-thinking-icon", text: "🔧" });
        head.createSpan({
          cls: "neuralnotes-thinking-name",
          text: name,
        });
        const target = this.permissionTarget(input);
        if (target) {
          head.createSpan({ cls: "neuralnotes-thinking-sep", text: "—" });
          head.createSpan({
            cls: "neuralnotes-thinking-target",
            text: target,
          });
        }
        if (id) rowsById.set(id, row);
        this.scrollToBottom();
      },
      addPermissionLog: (toolName, target, decision, scope) => {
        thinking.style.display = "";
        count += 1;
        thinkingCount.setText(` (${count})`);
        const row = thinkingList.createDiv({
          cls: `neuralnotes-thinking-row neuralnotes-thinking-row-permission neuralnotes-thinking-row-${decision}`,
        });
        const head = row.createDiv({ cls: "neuralnotes-thinking-head" });
        head.createSpan({
          cls: "neuralnotes-thinking-icon",
          text: decision === "allow" ? "🔓" : "🚫",
        });
        head.createSpan({
          cls: "neuralnotes-thinking-name",
          text: `Permission ${decision === "allow" ? "granted" : "denied"}`,
        });
        head.createSpan({ cls: "neuralnotes-thinking-sep", text: "—" });
        head.createSpan({
          cls: "neuralnotes-thinking-target",
          text: target ? `${toolName} (${target})` : toolName,
        });
        if (scope !== "once") {
          const scopeLabel =
            scope === "tool"
              ? `always for ${toolName}`
              : `always for this target`;
          head.createSpan({
            cls: "neuralnotes-thinking-scope",
            text: scopeLabel,
          });
        }
        this.scrollToBottom();
      },
      setThinkingResult: (id, isError, text) => {
        if (!id) return false;
        const row = rowsById.get(id);
        if (!row) return false;
        row.addClass(
          isError
            ? "neuralnotes-thinking-row-error"
            : "neuralnotes-thinking-row-ok",
        );
        if (isError && text && this.plugin.settings.debugMode) {
          const errDetails = row.createEl("details", {
            cls: "neuralnotes-thinking-result",
          });
          const errSummary = errDetails.createEl("summary", {
            cls: "neuralnotes-thinking-result-summary",
          });
          const firstLine = (text.split("\n")[0] ?? text).trim();
          const summaryText =
            firstLine.length > 120
              ? firstLine.slice(0, 117) + "…"
              : firstLine;
          errSummary.setText(summaryText);
          this.addCopyButton(errDetails, () => text);
          const errBody = errDetails.createEl("pre", {
            cls: "neuralnotes-thinking-result-body",
          });
          errBody.setText(text.slice(0, 4000));
        }
        this.scrollToBottom();
        return true;
      },
      finalize: () => {
        observer.disconnect();
        thinkingLabel.setText("Claude's thoughts");
        if (!bodyHasContent && body.hasClass("neuralnotes-placeholder")) {
          body.empty();
          body.removeClass("neuralnotes-placeholder");
          body.setText(count > 0 ? "(no message)" : "(no response)");
        }
        const { suggestions } = extractSuggestions(getText());
        if (suggestions.length) {
          this.populateSuggestions(suggestionsEl, suggestions);
        }
      },
    };
  }

  private populateSuggestions(container: HTMLElement, suggestions: string[]) {
    container.empty();
    container.style.display = "";
    for (const text of suggestions) {
      const btn = container.createEl("button", {
        cls: "neuralnotes-suggestion-btn",
        text,
      });
      btn.addEventListener("click", () => {
        if (this.currentAbort) return;
        container.querySelectorAll("button").forEach((b) => {
          (b as HTMLButtonElement).disabled = true;
        });
        void this.handleSend({ displayPrompt: text, actualPrompt: text });
      });
    }
  }

  private addCopyButton(messageEl: HTMLElement, getText: () => string) {
    const btn = messageEl.createEl("button", {
      cls: "neuralnotes-copy-btn",
      attr: { "aria-label": "Copy message", title: "Copy" },
    });
    setIcon(btn, "copy");
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const text = getText();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        setIcon(btn, "check");
        btn.addClass("neuralnotes-copy-btn-copied");
        window.setTimeout(() => {
          setIcon(btn, "copy");
          btn.removeClass("neuralnotes-copy-btn-copied");
        }, 1200);
      } catch (err) {
        new Notice("Failed to copy to clipboard");
        console.error(err);
      }
    });
  }

  private async renderMarkdown(target: HTMLElement, markdown: string) {
    const stripped = extractSuggestions(markdown).visible;
    const normalized = normalizeStreamingMarkdown(stripped);
    target.empty();
    await MarkdownRenderer.render(
      this.app,
      normalized,
      target,
      "",
      this.renderComponent,
    );
    this.scrollToBottom();
  }

  private appendSystemMessage(text: string) {
    const el = this.messagesEl.createDiv({
      cls: "neuralnotes-msg neuralnotes-msg-system",
    });
    el.setText(text);
    this.scrollToBottom();
  }

  private appendToolError(text: string) {
    const el = this.messagesEl.createDiv({
      cls: "neuralnotes-msg neuralnotes-msg-tool-error",
    });
    const display = `Tool error: ${text.slice(0, 500)}`;
    el.createDiv({ cls: "neuralnotes-msg-body", text: display });
    this.addCopyButton(el, () => `Tool error: ${text}`);
    this.scrollToBottom();
  }

  private appendErrorMessage(text: string) {
    const el = this.messagesEl.createDiv({
      cls: "neuralnotes-msg neuralnotes-msg-error",
    });
    el.createDiv({ cls: "neuralnotes-msg-body", text });
    this.addCopyButton(el, () => text);
    this.scrollToBottom();
  }

  private scrollToBottom() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}

interface AssistantBubbleHandle {
  body: HTMLDivElement;
  addThinkingItem: (name: string, input: unknown, id?: string) => void;
  addPermissionLog: (
    toolName: string,
    target: string | null,
    decision: "allow" | "deny",
    scope: "once" | "target" | "tool",
  ) => void;
  setThinkingResult: (
    id: string | undefined,
    isError: boolean,
    text: string,
  ) => boolean;
  finalize: () => void;
}

const THINKING_WORDS = [
  "Thinking",
  "Cogitating",
  "Pondering",
  "Mulling",
  "Ruminating",
  "Reflecting",
  "Contemplating",
  "Deliberating",
  "Musing",
  "Brewing",
  "Synthesizing",
  "Reasoning",
  "Computing",
  "Plotting",
  "Scheming",
  "Brainstorming",
  "Cooking",
  "Percolating",
  "Untangling",
  "Noodling",
];

function randomThinkingWord(): string {
  return THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)];
}

const SUGGESTIONS_RE = /<<<SUGGESTIONS:(\[[\s\S]*?\])>>>/;
const SUGGESTIONS_PARTIAL = "<<<SUGGESTIONS";

export function extractSuggestions(text: string): {
  visible: string;
  suggestions: string[];
} {
  const match = text.match(SUGGESTIONS_RE);
  if (match) {
    let suggestions: string[] = [];
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) {
        suggestions = parsed
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 6);
      }
    } catch {
      // ignore malformed payload
    }
    return {
      visible: text.replace(SUGGESTIONS_RE, "").trimEnd(),
      suggestions,
    };
  }
  // While streaming, hide a partial trailing marker so it doesn't flash as text.
  const partialIdx = text.lastIndexOf(SUGGESTIONS_PARTIAL);
  if (partialIdx >= 0 && !text.includes(">>>", partialIdx)) {
    return {
      visible: text.slice(0, partialIdx).trimEnd(),
      suggestions: [],
    };
  }
  return { visible: text, suggestions: [] };
}

// Streaming output from Claude sometimes embeds markdown structure mid-paragraph
// (e.g. "...done.* Step 2 — ..." with no newlines) which the renderer treats as
// literal text. Push list markers and headings onto their own lines so they
// render as actual blocks. Skips contents of fenced code blocks and inline code.
export function normalizeStreamingMarkdown(input: string): string {
  if (!input) return input;
  const segments = input.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return segments
    .map((seg, i) => {
      if (i % 2 === 1) return seg;
      let s = seg;
      // Headings glued to preceding text → push to a new paragraph.
      s = s.replace(/(?<=[^\n])(#{1,6}\s)/g, "\n\n$1");
      // Heading on a single newline → ensure blank line before it.
      s = s.replace(/(^|[^\n])\n(#{1,6}\s)/g, "$1\n\n$2");
      // Bullet items (`* ` or `- `) glued to preceding text → start a new line.
      // Match a non-newline character followed directly by a bullet marker.
      s = s.replace(/(?<=[^\s])([*-]\s)/g, "\n$1");
      // Indented bullets glued to preceding text (two-space prefix).
      s = s.replace(/(?<=[^\n])(  - )/g, "\n$1");
      // Numbered list items glued to preceding text ("...done.1. Next").
      s = s.replace(/(?<=[^\n])(\d+\.\s)/g, "\n$1");
      return s;
    })
    .join("");
}
