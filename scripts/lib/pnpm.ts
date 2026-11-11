// How to run pnpm from a Node script on every OS, without weakening what the script checks.
// On Windows a global pnpm is a `pnpm.cmd` shim: execFileSync of plain pnpm fails with ENOENT, and Node refuses to
// run a .cmd file without a shell (CVE-2024-27980). So, in order:
//   1. Under `pnpm run` (how `pnpm check` runs every script) pnpm sets npm_execpath to its own JS entry point;
//      run that with this Node, no shell, on any OS.
//   2. Otherwise on Windows: `pnpm.cmd` through the shell, only for fixed arguments made of plain characters
//      (anything else is refused, so nothing can be injected into the command line).
//   3. Otherwise: the `pnpm` executable, no shell.
import { execFileSync } from "node:child_process";

export interface PnpmInvocation {
  file: string;
  args: string[];
  shell: boolean;
}

/** Plain characters only: letters, digits and @ . _ / = : - (pnpm sub-commands, flags and package names). */
const PLAIN_ARG = /^[A-Za-z0-9@._/=:-]+$/u;
const PNPM_JS = /^pnpm\.(?:c?js|mjs)$/u;

export function pnpmInvocation(
  args: readonly string[],
  context: { platform: NodeJS.Platform; npmExecPath: string | undefined; nodePath: string },
): PnpmInvocation {
  const { platform, npmExecPath, nodePath } = context;
  // Split on both separators: the path may be a Windows one, whatever OS reads it.
  if (npmExecPath !== undefined && PNPM_JS.test(npmExecPath.split(/[\\/]/u).pop() ?? "")) {
    return { file: nodePath, args: [npmExecPath, ...args], shell: false };
  }
  if (platform === "win32") {
    const bad = args.find((a) => !PLAIN_ARG.test(a));
    if (bad !== undefined) throw new Error(`refusing to pass ${JSON.stringify(bad)} to pnpm.cmd through a shell`);
    // One command string and no separate args: the shell gets exactly these plain words.
    return { file: ["pnpm.cmd", ...args].join(" "), args: [], shell: true };
  }
  return { file: "pnpm", args: [...args], shell: false };
}

/** execFileSync for pnpm that works on Linux, macOS and Windows (see the top of this file). */
export function runPnpm(args: readonly string[], options: { cwd: string; maxBuffer?: number }): string {
  const inv = pnpmInvocation(args, {
    platform: process.platform,
    npmExecPath: process.env["npm_execpath"],
    nodePath: process.execPath,
  });
  return execFileSync(inv.file, inv.args, { ...options, encoding: "utf8", shell: inv.shell });
}
