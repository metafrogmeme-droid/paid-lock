import { describe, expect, it } from "vitest";
import { checkRelease, PUBLISHED, type ReleaseInput } from "../scripts/lib/release.ts";
import { runScript } from "./run.ts";

function input(over: Partial<ReleaseInput> = {}): ReleaseInput {
  return {
    version: "0.1.0",
    confirm: "publish 0.1.0",
    packages: PUBLISHED.map((dir) => ({ dir, name: dir, version: "0.1.0", license: "MIT" })),
    cliVersion: "0.1.0",
    changelog: "# Changelog\n\n## 0.1.0\n\n- First release.\n",
    ...over,
  };
}

describe("release check (nothing is published unless every gate passes)", () => {
  it("passes a consistent, confirmed release", () => {
    expect(checkRelease(input())).toEqual([]);
  });

  it("publishes in dependency order: core first, the CLI last", () => {
    expect(PUBLISHED[0]).toBe("packages/core");
    expect(PUBLISHED.at(-1)).toBe("packages/cli");
  });

  it.each([
    ["a version that is not X.Y.Z", { version: "0.1", confirm: "publish 0.1" }, "X.Y.Z"],
    ["a missing confirmation", { confirm: "" }, 'type "publish 0.1.0"'],
    ["a confirmation for another version", { confirm: "publish 0.2.0" }, 'type "publish 0.1.0"'],
    ["a CLI VERSION that differs", { cliVersion: "0.0.0" }, "VERSION"],
    ["no changelog section", { changelog: "# Changelog\n" }, "## 0.1.0"],
  ])("refuses %s", (_name, over, word) => {
    expect(checkRelease(input(over)).join("\n")).toContain(word);
  });

  it("refuses a package that is still private, has another version or another licence", () => {
    const packages = input().packages.map((p, i) =>
      i === 0 ? { ...p, private: true } : i === 1 ? { ...p, version: "0.0.9" } : i === 2 ? { ...p, license: "ISC" } : p,
    );
    const problems = checkRelease(input({ packages })).join("\n");
    expect(problems).toContain("packages/core is private");
    expect(problems).toContain("packages/protocols has version 0.0.9");
    expect(problems).toContain("packages/probe is not MIT");
  });

  it("refuses when a published package is missing from the list", () => {
    expect(checkRelease(input({ packages: input().packages.slice(1) })).join("\n")).toContain(
      "packages/core is missing",
    );
  });

  it("refuses this repository today: every package is still private (nothing to publish yet)", () => {
    const r = runScript("scripts/release-check.ts", ["0.1.0", "publish 0.1.0"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("is private");
  });

  it("needs both arguments", () => {
    expect(runScript("scripts/release-check.ts", []).status).toBe(2);
  });
});
