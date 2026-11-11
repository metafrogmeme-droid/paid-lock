// scripts/lib/pnpm.ts: pnpm from Node scripts on Linux, macOS and Windows (where pnpm is a .cmd shim).
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pnpmInvocation, runPnpm } from "../scripts/lib/pnpm.ts";

const ROOT = resolve(import.meta.dirname, "..");
const NODE = "/usr/bin/node";
const LS = ["ls", "-r", "--prod", "--json", "--depth", "Infinity"];

describe("pnpmInvocation", () => {
  it("under `pnpm run`, runs pnpm's own JS entry with this node and no shell, on every OS", () => {
    for (const platform of ["win32", "linux", "darwin"] as const) {
      for (const entry of ["C:\\pnpm\\bin\\pnpm.cjs", "/usr/lib/node_modules/pnpm/bin/pnpm.cjs", "/x/pnpm.mjs"]) {
        expect(pnpmInvocation(LS, { platform, npmExecPath: entry, nodePath: NODE })).toEqual({
          file: NODE,
          args: [entry, ...LS],
          shell: false,
        });
      }
    }
  });

  it("ignores npm_execpath when it is not pnpm (e.g. npm's own entry)", () => {
    const npm = "/usr/lib/node_modules/npm/bin/npm-cli.js";
    expect(pnpmInvocation(LS, { platform: "linux", npmExecPath: npm, nodePath: NODE })).toEqual({
      file: "pnpm",
      args: LS,
      shell: false,
    });
  });

  it("on Windows without npm_execpath, runs pnpm.cmd through the shell as one plain command string", () => {
    expect(pnpmInvocation(LS, { platform: "win32", npmExecPath: undefined, nodePath: NODE })).toEqual({
      file: "pnpm.cmd ls -r --prod --json --depth Infinity",
      args: [],
      shell: true,
    });
  });

  it("on Windows, refuses any argument that is not plain characters (nothing reaches the shell)", () => {
    for (const bad of ["a&b", "x y", 'q"', "a|b", "%PATH%", "^", "a>b", "", "$(x)"]) {
      expect(() => pnpmInvocation(["ls", bad], { platform: "win32", npmExecPath: undefined, nodePath: NODE })).toThrow(
        "refusing to pass",
      );
    }
  });

  it("elsewhere without npm_execpath, runs the pnpm executable with no shell", () => {
    for (const platform of ["linux", "darwin"] as const) {
      expect(pnpmInvocation(["ls", "a&b"], { platform, npmExecPath: undefined, nodePath: NODE })).toEqual({
        file: "pnpm",
        args: ["ls", "a&b"],
        shell: false,
      });
    }
  });
});

describe("scripts that run pnpm", () => {
  it("runPnpm runs pnpm on this machine", { timeout: 60_000 }, () => {
    expect(runPnpm(["--version"], { cwd: ROOT }).trim()).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("check-deps passes with and without npm_execpath (the two non-Windows paths)", { timeout: 60_000 }, () => {
    const withEntry = { ...process.env };
    const without = { ...process.env };
    delete without["npm_execpath"];
    for (const env of [withEntry, without]) {
      const r = spawnSync(process.execPath, [join(ROOT, "scripts/check-deps.ts")], {
        cwd: ROOT,
        env,
        encoding: "utf8",
      });
      expect([r.status, r.stderr]).toEqual([0, ""]);
      expect(r.stdout).toContain("check-deps: OK");
    }
  });

  it("no script under scripts/ spawns pnpm or npm directly (they go through scripts/lib/pnpm.ts)", () => {
    const files = readdirSync(join(ROOT, "scripts"), { recursive: true, encoding: "utf8" }).filter((f) =>
      f.endsWith(".ts"),
    );
    const direct = /\b(?:execFileSync|execFile|spawnSync|spawn|execSync|exec)\(\s*["'`](?:pnpm|npm|npx)["'`]/u;
    expect(files.filter((f) => direct.test(readFileSync(join(ROOT, "scripts", f), "utf8")))).toEqual([]);
  });
});
