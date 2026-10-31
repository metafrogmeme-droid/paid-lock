// Written with AI help.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");

/** Run a repo script with node and return its exit status and output. */
export function runScript(
  script: string,
  args: readonly string[],
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [resolve(ROOT, script), ...args], { cwd: ROOT, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
