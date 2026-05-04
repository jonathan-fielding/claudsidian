import { FileSystemAdapter } from "obsidian";
import type ClaudsidianPlugin from "./main";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";

const execFileP = promisify(execFile);

export interface ClaudeEvent {
  kind: "assistant-text" | "tool-use" | "tool-result" | "system" | "result" | "error";
  text?: string;
  tool?: string;
  toolInput?: unknown;
  toolUseId?: string;
  isError?: boolean;
  sessionId?: string;
}

export interface PermissionRequest {
  tool: string;
  input: unknown;
}

export type PermissionResponse =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

export interface RunOptions {
  prompt: string;
  resumeSessionId?: string;
  signal?: AbortSignal;
  onEvent: (e: ClaudeEvent) => void;
  canUseTool?: (req: PermissionRequest) => Promise<PermissionResponse>;
}

function getVaultPath(plugin: ClaudsidianPlugin): string {
  const adapter = plugin.app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    return adapter.getBasePath();
  }
  throw new Error(
    "Claudsidian requires a desktop vault (FileSystemAdapter).",
  );
}

let cachedClaudePath: string | null = null;

const COMMON_CLAUDE_PATHS = [
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude",
  `${process.env.HOME ?? ""}/.claude/local/claude`,
  `${process.env.HOME ?? ""}/.local/bin/claude`,
  `${process.env.HOME ?? ""}/.npm-global/bin/claude`,
];

async function detectClaudeBinary(): Promise<string> {
  if (cachedClaudePath) return cachedClaudePath;

  for (const candidate of COMMON_CLAUDE_PATHS) {
    if (candidate && fs.existsSync(candidate)) {
      cachedClaudePath = candidate;
      return candidate;
    }
  }

  const lookup = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileP(lookup, ["claude"]);
    const found = stdout.split("\n")[0]?.trim();
    if (found) {
      cachedClaudePath = found;
      return found;
    }
  } catch {
    // fall through to error below
  }

  throw new Error(
    "Could not locate the `claude` CLI. Install Claude Code and run `claude login`, " +
      "then set the binary path in Claudsidian settings.",
  );
}

export async function runClaudeQuery(
  plugin: ClaudsidianPlugin,
  options: RunOptions,
): Promise<string | undefined> {
  const cwd = getVaultPath(plugin);
  const settings = plugin.settings;

  const claudePath = settings.pathToClaudeBinary
    ? settings.pathToClaudeBinary
    : await detectClaudeBinary();

  const queryOptions: Record<string, unknown> = {
    cwd,
    permissionMode: settings.permissionMode,
    pathToClaudeCodeExecutable: claudePath,
    env: buildChildEnv(claudePath),
  };

  const vaultContext = [
    `The user's Obsidian vault is located at: ${cwd}`,
    `This vault is your ONLY source of information about the user. You are an Obsidian assistant — you do not have access to and must NOT mention or offer to search: the broader local filesystem, Google Drive, calendars, email, the web, external APIs, or any service outside this vault. The vault contains everything you need.`,
    `When the user asks a personal question (e.g. "what talks did I give in 2025?", "what's my address?", "what books have I read?"), answer it by searching this vault. Do not say "I don't have access to your records" — search the vault first. If after searching the vault you still cannot answer, say so plainly and ask the user where in the vault that information lives.`,
    `cwd is the vault root. All notes are inside this directory. When referring to a note, use a path relative to cwd (e.g. "CLAUDE.md", "Daily/2026-05-04.md") — do NOT use absolute paths starting with /Users/, /root/, /home/, /etc/, ~, or any path you "remember" from elsewhere; those will be auto-denied.`,
    `Read/Edit/Write only operate on individual files. To inspect or list a directory's contents, use Glob (e.g. pattern "Talks/**/*.md") or LS — never call Read on a folder name.`,
    `Start most personal-information queries with a Glob over the vault (e.g. Glob "**/*.md" or a topical pattern) so you discover what's actually there before guessing.`,
  ].join("\n\n");
  const composedPrompt = settings.systemPromptAddendum
    ? `${vaultContext}\n\n${settings.systemPromptAddendum}`
    : vaultContext;
  queryOptions.appendSystemPrompt = composedPrompt;

  if (options.resumeSessionId) {
    queryOptions.resume = options.resumeSessionId;
  }

  if (options.signal) {
    queryOptions.abortController = abortControllerFrom(options.signal);
  }

  const usingCanUseTool = !!options.canUseTool;
  if (usingCanUseTool) {
    queryOptions.canUseTool = async (
      toolName: string,
      input: unknown,
    ): Promise<PermissionResponse> => {
      return options.canUseTool!({ tool: toolName, input });
    };
  }

  // The SDK requires streaming-input format when canUseTool is set.
  const promptArg: any = usingCanUseTool
    ? singleMessageStream(options.prompt, options.resumeSessionId)
    : options.prompt;

  const iterator = sdkQuery({
    prompt: promptArg,
    options: queryOptions,
  } as Parameters<typeof sdkQuery>[0]);

  let lastSessionId: string | undefined;

  for await (const message of iterator as AsyncIterable<any>) {
    if (options.signal?.aborted) break;

    if (message.session_id) lastSessionId = message.session_id;

    if (message.type === "system" && message.subtype === "init") {
      options.onEvent({ kind: "system", sessionId: message.session_id });
      continue;
    }

    if (message.type === "assistant" && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) {
          options.onEvent({ kind: "assistant-text", text: block.text });
        } else if (block.type === "tool_use") {
          options.onEvent({
            kind: "tool-use",
            tool: block.name,
            toolInput: block.input,
            toolUseId: block.id,
          });
        }
      }
    }

    if (message.type === "user" && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === "tool_result") {
          options.onEvent({
            kind: "tool-result",
            isError: !!block.is_error,
            toolUseId: block.tool_use_id,
            text:
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content),
          });
        }
      }
    }

    if (message.type === "result") {
      options.onEvent({
        kind: "result",
        text: message.result,
        isError: message.is_error,
        sessionId: message.session_id,
      });
    }
  }

  return lastSessionId;
}

function buildChildEnv(claudeBinaryPath: string): Record<string, string> {
  const home = os.homedir();
  const inherited: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") inherited[k] = v;
  }
  // Electron's renderer can have HOME unset/wrong, which makes the spawned
  // `claude` CLI look for ~/.claude config under /root. Force the real home.
  inherited.HOME = home;
  if (process.platform !== "win32" && !inherited.USER) {
    inherited.USER = os.userInfo().username;
  }
  // Ensure the directory containing the claude binary is on PATH so any
  // helpers it shells out to are also resolvable.
  const binDir = path.dirname(claudeBinaryPath);
  const sep = process.platform === "win32" ? ";" : ":";
  const currentPath = inherited.PATH ?? "";
  if (!currentPath.split(sep).includes(binDir)) {
    inherited.PATH = currentPath ? `${binDir}${sep}${currentPath}` : binDir;
  }
  return inherited;
}

async function* singleMessageStream(
  prompt: string,
  resumeSessionId: string | undefined,
): AsyncGenerator<any> {
  yield {
    type: "user",
    message: { role: "user", content: prompt },
    parent_tool_use_id: null,
    session_id: resumeSessionId ?? "",
  };
}

function abortControllerFrom(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}
