import { readFileSync, writeFileSync } from "fs";

// Works both when invoked via `npm version` (sets npm_package_version) and
// standalone after `changeset version` (reads package.json directly).
const targetVersion =
  process.env.npm_package_version ||
  JSON.parse(readFileSync("package.json", "utf8")).version;

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
