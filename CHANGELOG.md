# neuralnotes

## 1.0.2

### Patch Changes

- 8e4db9a: Resolve Obsidian plugin review feedback: replace `any` types with SDK types, drop the plugin name from command id/name, fix sentence case in UI text, await `revealLeaf` promises, swap inline `style.display` for a CSS class, and tighten async generator/regex/event-handler typing.

## 1.0.1

### Patch Changes

- 7ed8c14: Update plugin description in manifest.json to "Interact with Claude Code, with a chat that that can read and edit your vault notes."

## 1.0.0

### Major Changes

- d587653: Renamed plugin from Claudsidian to NeuralNotes. The plugin id in manifest.json has changed from `claudsidian` to `neuralnotes` — existing users will need to reinstall the plugin under the new folder name.

## 0.1.2

### Upgrade note

- The plugin id/folder name has changed from `claudsidian` to `neuralnotes`.
- Existing users may need to rename or remove the old `claudsidian` plugin folder before enabling this version.
- Because Obsidian stores plugin settings and hotkeys by plugin id, you may need to reconfigure settings and hotkeys after upgrading.
- Existing workspace panes opened with the previous plugin id may need to be closed and reopened.

### Patch Changes

- 2d18ea5: Sync manifest.json and versions.json to match package.json version so all three files stay in sync with changeset releases.

## 0.1.1

### Patch Changes

- 59b10b4: Initial release
- 1605ff9: Bump version
