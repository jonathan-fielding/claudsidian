# NeuralNotes

Chat with Claude Code from inside Obsidian. A custom main-area pane lets Claude read, search, and edit notes in your vault using its full agent toolkit (Read, Edit, Write, Glob, Grep, LS, Bash). Permission prompts, a "Claude's thoughts" log, quick-reply buttons, and a guided CLAUDE.md setup are built in.

> **Desktop only.** This plugin spawns the local `claude` CLI as a subprocess, so it does not work on Obsidian mobile.

## Requirements

- Obsidian **1.5.0** or later (desktop).
- [Claude Code](https://docs.anthropic.com/claude/docs/claude-code) installed locally and signed in (`claude login`).

The plugin auto-detects `claude` in common install paths (`/usr/local/bin`, `/opt/homebrew/bin`, `~/.claude/local`, `~/.local/bin`, `~/.npm-global/bin`) and falls back to `which claude` / `where claude`. You can also set the path explicitly in settings.

## Install

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest).
2. Create a folder `neuralnotes` inside your vault's `.obsidian/plugins/` directory.
3. Drop the three files into that folder.
4. In Obsidian → Settings → Community plugins, enable **NeuralNotes**.

### Install via BRAT

If you use the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin to track beta plugins, add this repo's URL and BRAT will keep NeuralNotes up to date.

### Build from source

```bash
git clone <this-repo>
cd <repo>
npm install
npm run build
```

`main.js` is produced in the repo root. Symlink or copy the repo folder into `<vault>/.obsidian/plugins/neuralnotes/` (the folder must be named `neuralnotes` to match `manifest.json`'s id).

## Usage

- Click the **bot** icon in the ribbon (or run "Open NeuralNotes pane" from the command palette) to open the chat pane in the main area.
- Type a question and press **Send** (or ⌘/Ctrl+Enter — see settings).
- Claude works from your vault root, so paths like `Daily/2026-05-04.md` resolve relative to it.
- Tools that touch files outside the vault (e.g. `/root/CLAUDE.md`) are auto-denied with a hint to retry using a vault-relative path.
- Tools that require permission show a bubble with **Allow once / Allow this target / Always allow / Deny** options. Approved scopes persist for the rest of the chat.
- The collapsible **Claude's thoughts** section logs every tool call (and any errors) so you can audit what Claude actually did.

### CLAUDE.md

When the pane opens (or you start a new chat):

- **No CLAUDE.md in vault root** → NeuralNotes offers to walk you through creating one. Claude will scan your folder structure, ask one question at a time (with quick-reply buttons), draft a CLAUDE.md, and write it on your approval.
- **CLAUDE.md exists with a session-start protocol** (e.g. it says "Start each session by…") → NeuralNotes offers to run that protocol now. Click **Run protocol** and Claude streams its progress as a checklist.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Path to `claude` binary | (auto-detect) | Override the binary lookup. |
| Permission mode | `acceptEdits` | SDK permission mode. `acceptEdits` auto-approves edits inside cwd; reads outside cwd still prompt. `bypassPermissions` allows everything. `plan` is read-only. |
| Send on Enter | off | When on, Enter sends and ⌘/Ctrl+Enter inserts a newline. When off, Enter inserts a newline and ⌘/Ctrl+Enter sends. |
| Restrict to vault | on | Auto-deny any tool call that targets a path outside the vault. |
| Debug mode | off | Show full tool input JSON and tool error details inline in the thinking log. |
| System prompt addendum | (sensible default) | Appended to Claude's system prompt every query. |

The plugin always injects the actual vault path into Claude's system context so the model knows exactly where it is.

## How it works

- The plugin uses [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), which spawns the local `claude` CLI as a subprocess.
- Working directory is set to your vault root via Obsidian's `FileSystemAdapter.getBasePath()`.
- `HOME` and `PATH` are propagated into the subprocess so Claude can locate its config.
- Tool-use permissions are wired through a `canUseTool` callback that opens an in-pane prompt; allowed scopes are remembered for the rest of the chat.
- Streaming markdown is normalized on the way in so inline list markers and headings render correctly even if Claude emits them mid-token.

## Development

```bash
npm install
npm run dev      # esbuild in watch mode
npm run build    # type-check + production bundle
npm run typecheck
```

Source layout:

- `src/main.ts` — plugin entry, ribbon, command, view registration.
- `src/view.ts` — the chat pane (UI, streaming, permissions, suggestions).
- `src/claude.ts` — wraps the Claude Agent SDK and runs the query.
- `src/settings.ts` — settings tab.
- `styles.css` — pane styling.
- `esbuild.config.mjs` — bundles `src/main.ts` → `main.js` (CJS, Node platform).

## Release process

1. Bump the version: `npm version patch|minor|major` — the `version` script in `package.json` updates `manifest.json` and `versions.json` automatically via `version-bump.mjs`.
2. Push the resulting tag: `git push --follow-tags`.
3. The GitHub Actions release workflow builds the plugin, attaches `main.js`, `manifest.json`, and `styles.css` to a new GitHub release named after the tag.

## License

MIT.
