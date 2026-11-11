// Windows portability of the steps scripts/first-publish.sh runs (`pnpm check`, `pnpm demo`).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { minimalChildEnv } from "../scripts/lib/child-env.ts";

const ROOT = resolve(import.meta.dirname, "..");

describe("minimalChildEnv (the demo's environment for the CLI)", () => {
  const env = { PATH: "/usr/bin", HOME: "/home/x", EXTRA_VAR: "not-for-the-cli", SystemRoot: "C:\\Windows" };

  it("on Linux and macOS: only PATH", () => {
    for (const platform of ["linux", "darwin"] as const) {
      expect(minimalChildEnv(env, platform)).toEqual({ PATH: "/usr/bin" });
    }
  });

  it("on Windows: PATH and SystemRoot (Winsock needs it), looked up case-insensitively, nothing else", () => {
    expect(
      minimalChildEnv({ Path: "C:\\bin", SYSTEMROOT: "C:\\Windows", EXTRA_VAR: "x", USERPROFILE: "C:\\u" }, "win32"),
    ).toEqual({
      PATH: "C:\\bin",
      SystemRoot: "C:\\Windows",
    });
  });

  it("never passes anything else, and copes with a missing PATH or SystemRoot", () => {
    expect(minimalChildEnv({}, "win32")).toEqual({ PATH: "" });
    expect(minimalChildEnv({}, "linux")).toEqual({ PATH: "" });
    expect(Object.keys(minimalChildEnv(env, "win32")).sort()).toEqual(["PATH", "SystemRoot"]);
  });
});

describe("scripts run by first-publish.sh", () => {
  it("stop child processes without POSIX signals (a child's SIGTERM on Windows runs no handler)", () => {
    for (const file of ["scripts/smoke-mock-seller.ts", "scripts/demo.ts"]) {
      const text = readFileSync(resolve(ROOT, file), "utf8");
      expect(text, file).not.toMatch(/kill\(\s*["']SIG(?:TERM|INT)["']/u);
    }
  });

  it("the demo starts the CLI with minimalChildEnv, not a hand-built environment", () => {
    const demo = readFileSync(resolve(ROOT, "scripts/demo.ts"), "utf8");
    expect(demo).toContain("env: minimalChildEnv(process.env, process.platform)");
  });
});
