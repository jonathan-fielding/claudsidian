import { readFileSync, writeFileSync } from "fs";

// Always read from package.json directly so this works correctly both when
// invoked via `npm version` (which updates package.json before running lifecycle
// scripts) and when run after `changeset version` (which also updates
// package.json). Using process.env.npm_package_version would give the stale
// pre-changeset version when called from the `version:packages` npm script.
const targetVersion = JSON.parse(readFileSync("package.json", "utf8")).version;

if (!targetVersion) {
  console.error("Could not determine version. Run via `npm version` or after `changeset version`.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const minAppVersion = manifest.minAppVersion;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");

console.log(
  `Bumped manifest.json and versions.json to ${targetVersion} (minAppVersion ${minAppVersion}).`,
);
