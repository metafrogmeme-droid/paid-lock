// Written with AI help.
// Usage: node scripts/check-guard-reach.ts   Exit 0 when every adapter pay path reaches a check, 1 otherwise.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoFiles } from "./lib/files.ts";
import { checkGuardReach, isAdapterFile } from "./lib/guard-reach.ts";

const root = resolve(import.meta.dirname, "..");
const files = repoFiles(root).filter(isAdapterFile);
if (files.length === 0) {
  process.stderr.write("guard-reach: no adapter files found under packages/runtime/src/adapters\n");
  process.exit(1);
}
const problems = files.flatMap((f) => checkGuardReach(f, readFileSync(resolve(root, f), "utf8")));
for (const p of problems) process.stdout.write(`${p.file}:${String(p.line)}: ${p.problem}\n`);
if (problems.length > 0) {
  process.stderr.write(
    `guard-reach: ${String(problems.length)} problem(s); every pay path must call a paid.lock check\n`,
  );
  process.exit(1);
}
process.stdout.write(`guard-reach: OK (${String(files.length)} adapter file(s), every pay path reaches a check)\n`);
