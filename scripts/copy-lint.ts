// Usage: node scripts/copy-lint.ts [file ...]
// No arguments: every tracked or untracked-not-ignored text file. Exit 0 clean, 1 findings, 2 usage error.
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { repoFiles, toPosix } from "./lib/files.ts";
import { isScanned, lintText, type Finding } from "./lib/copy-lint.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const missing = args.filter((f) => !existsSync(f));
if (missing.length > 0) {
  process.stderr.write(`copy-lint: no such file: ${missing.join(", ")}\n`);
  process.exit(2);
}
const files = args.length > 0 ? args.map((f) => toPosix(relative(root, resolve(f)))) : repoFiles(root);
const scanned = files.filter(isScanned);
const findings: Finding[] = scanned.flatMap((f) => lintText(f, readFileSync(resolve(root, f), "utf8")));
for (const f of findings) process.stdout.write(`${f.file}:${String(f.line)}: ${f.message}\n`);
if (findings.length > 0) {
  process.stderr.write(`copy-lint: ${String(findings.length)} finding(s) (CLAUDE.md §5 rules 6-8)\n`);
  process.exit(1);
}
process.stdout.write(`copy-lint: OK (${String(scanned.length)} files)\n`);
