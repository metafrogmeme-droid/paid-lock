// Written with AI help.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isScanned, lintText } from "../scripts/lib/copy-lint.ts";
import { runScript } from "./run.ts";

// Banned words are assembled at run time so this file itself passes the lint.
const W = { s: "sa" + "fe", sc: "sc" + "am", t: "tru" + "sted", p: "pre" + "sale", st: "sta" + "king" };
const LABEL = "<!-- Written with AI help. -->\n";

describe("copy-lint rules", () => {
  it.each([
    [`This endpoint is ${W.s}.`, W.s],
    [`Possible ${W.sc}!`, W.sc],
    [`A ${W.t} seller`, W.t],
    [`Join the ${W.p}`, W.p],
    [`${W.st} rewards`, W.st],
    [`${W.s.toUpperCase()} TO PAY`, W.s.toUpperCase()],
  ])("flags %j", (text, word) => {
    const f = lintText("docs/x.md", LABEL + text);
    expect(f).toEqual([{ file: "docs/x.md", line: 2, message: `banned word "${word}"` }]);
  });

  it.each(["Blocked by your rule: payTo changed", "un" + W.t + " input", W.s + "ty notes", "Number.MAX_SAFE_INTEGER"])(
    "does not flag %j",
    (text) => {
      expect(lintText("docs/x.md", LABEL + text)).toEqual([]);
    },
  );

  it("requires the AI-help label near the top of docs, code and scenarios", () => {
    expect(lintText("docs/x.md", "# Title\n")[0]?.message).toMatch(/missing "Written with AI help"/);
    expect(lintText("src/a.ts", "export {};\n")[0]?.message).toMatch(/label/);
    expect(lintText("fixtures/mock-seller/scenarios/a.json", "{}\n")[0]?.message).toMatch(/label/);
    expect(lintText("package.json", "{}\n")).toEqual([]);
  });

  it("skips the brief and generated files", () => {
    expect(isScanned("CLAUDE.md")).toBe(false);
    expect(isScanned("pnpm-lock.yaml")).toBe(false);
    expect(isScanned("docs/DECISIONS.md")).toBe(true);
    expect(isScanned(".githooks/pre-commit")).toBe(true);
    expect(isScanned("image.png")).toBe(false);
  });
});

describe("copy-lint CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "copy-lint-"));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails on a planted banned word (M1 acceptance check)", () => {
    const planted = join(dir, "planted.md");
    writeFileSync(planted, `${LABEL}This seller is ${W.s}.\n`);
    const r = runScript("scripts/copy-lint.ts", [planted]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`banned word "${W.s}"`);
  });

  it("passes a clean file", () => {
    const clean = join(dir, "clean.md");
    writeFileSync(clean, `${LABEL}Needs your OK: terms changed.\n`);
    expect(runScript("scripts/copy-lint.ts", [clean]).status).toBe(0);
  });

  it("exits 2 for a missing file", () => {
    expect(runScript("scripts/copy-lint.ts", [join(dir, "nope.md")]).status).toBe(2);
  });
});
