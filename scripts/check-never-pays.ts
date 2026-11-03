// Usage: node scripts/check-never-pays.ts [file ...]   Exit 0 clean, 1 hits.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoFiles } from "./lib/files.ts";
import { isShippedCode, scanText } from "./lib/never-pays.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const files = args.length > 0 ? args : repoFiles(root).filter(isShippedCode);
const hits = files.flatMap((f) => scanText(f, readFileSync(resolve(root, f), "utf8")));
for (const h of hits) process.stdout.write(`${h.file}:${String(h.line)}: ${h.id}\n`);
if (hits.length > 0) {
  process.stderr.write(
    `never-pays: ${String(hits.length)} hit(s); shipped code must not pay or sign (CLAUDE.md §5 rule 3)\n`,
  );
  process.exit(1);
}
process.stdout.write(`never-pays: OK (${String(files.length)} shipped files, no payment header or signing call)\n`);
