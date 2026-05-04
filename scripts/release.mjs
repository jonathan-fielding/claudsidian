import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const version = pkg.version;

execSync("npm run build", { stdio: "inherit" });

for (const f of ["main.js", "manifest.json", "styles.css"]) {
  if (!existsSync(f)) {
    console.error(`Missing required build artifact: ${f}`);
    process.exit(1);
  }
}

execSync(
  `gh release create "${version}" --title "${version}" --generate-notes main.js manifest.json styles.css`,
  { stdio: "inherit" }
);

console.log(`Released ${version}`);
