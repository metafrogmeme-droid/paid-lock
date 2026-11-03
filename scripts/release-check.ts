// Usage: node scripts/release-check.ts <version> "publish <version>"
// Exit 0 when every release gate passes, 1 when one fails, 2 on bad usage. Run by .github/workflows/release.yml
// before anything is packed or published; also fine to run locally (it only reads files).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkRelease, PUBLISHED, type PackageInfo } from "./lib/release.ts";

const [version, confirm] = process.argv.slice(2);
if (version === undefined || confirm === undefined) {
  process.stderr.write('usage: release-check.ts <version> "publish <version>"\n');
  process.exit(2);
}
const root = resolve(import.meta.dirname, "..");
const packages: PackageInfo[] = PUBLISHED.map((dir) => {
  const json = JSON.parse(readFileSync(resolve(root, dir, "package.json"), "utf8")) as Omit<PackageInfo, "dir">;
  return { dir, ...json };
});
const cliVersion =
  /export const VERSION = "([^"]*)"/u.exec(readFileSync(resolve(root, "packages/cli/src/main.ts"), "utf8"))?.[1] ?? "";
const changelogPath = resolve(root, "CHANGELOG.md");
const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "";
const problems = checkRelease({ version, confirm, packages, cliVersion, changelog });
for (const p of problems) process.stderr.write(`release-check: ${p}\n`);
if (problems.length > 0) process.exit(1);
process.stdout.write(`release-check: OK (${String(PUBLISHED.length)} packages at ${version}, confirmed)\n`);
