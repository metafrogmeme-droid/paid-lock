// Usage: node scripts/check-deps.ts   Exit 0 clean, 1 problems, 2 tool error.
// Reads the installed production dependency trees from `pnpm ls` and applies scripts/lib/deps.ts.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { checkPackage, GUARDED, type DepNode } from "./lib/deps.ts";

const root = resolve(import.meta.dirname, "..");
const raw = execFileSync("pnpm", ["ls", "-r", "--prod", "--json", "--depth", "Infinity"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const trees = JSON.parse(raw) as DepNode[];
const byName = new Map(trees.map((t) => [t.name, t]));
const missing = GUARDED.filter((g) => !byName.has(g));
if (missing.length > 0) {
  process.stderr.write(`check-deps: guarded package(s) not found in workspace: ${missing.join(", ")}\n`);
  process.exit(2);
}
const problems = GUARDED.flatMap((g) => {
  const tree = byName.get(g);
  return tree === undefined ? [] : checkPackage(tree);
});
for (const p of problems) process.stdout.write(`${p.pkg}: ${p.reason}: ${p.path}\n`);
if (problems.length > 0) {
  process.stderr.write(`check-deps: ${String(problems.length)} problem(s) (CLAUDE.md §5 rule 3a)\n`);
  process.exit(1);
}
process.stdout.write(`check-deps: OK (${GUARDED.join(", ")}: no wallet or signing library, all deps allowlisted)\n`);
