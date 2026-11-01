// Written with AI help.
import { execFileSync } from "node:child_process";

/** Tracked and untracked-but-not-ignored files of the repo at `root`, repo-relative. */
export function repoFiles(root: string): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });
  return [...new Set(out.split("\0").filter((f) => f !== ""))].sort();
}

export function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}
