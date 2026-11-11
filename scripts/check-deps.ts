// Usage: node scripts/check-deps.ts   Exit 0 clean, 1 problems, 2 tool error.
// Reads the installed production dependency trees from `pnpm ls` and applies scripts/lib/deps.ts.
import { resolve } from "node:path";
import { checkPackage, GUARDED, type DepNode } from "./lib/deps.ts";
import { runPnpm } from "./lib/pnpm.ts";

const root = resolve(import.meta.dirname, "..");
// Through runPnpm so it also runs on Windows, where pnpm is a .cmd shim (scripts/lib/pnpm.ts).
const raw = runPnpm(["ls", "-r", "--prod", "--json", "--depth", "Infinity"], {
  cwd: root,
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
