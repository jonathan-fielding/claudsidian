# Changesets

This directory contains changesets — individual markdown files that describe changes made to the plugin.

## Workflow

1. **Add a changeset** when making a notable change:
   ```sh
   npm run changeset
   ```
   This prompts you for bump type (patch/minor/major) and a description, then writes a file here.

2. **Release** (automated): push your branch to `main`. The GitHub Actions workflow will open a "Version Packages" PR that bumps `package.json`, `manifest.json`, `versions.json`, and `CHANGELOG.md`. Merge it to publish a GitHub Release.

3. **Release** (manual):
   ```sh
   npm run version:packages   # apply pending changesets
   git add -A && git commit -m "chore: version packages"
   npm run release            # build + create GitHub Release
   ```
