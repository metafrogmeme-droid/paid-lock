// Written with AI help.
import { describe, expect, it } from "vitest";
import { EXIT, main, type Io } from "./main.ts";

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s) }, out, err };
}

describe("paid-lock main", () => {
  it("prints the version", () => {
    const c = capture();
    expect(main(["--version"], c.io)).toBe(EXIT.allowed);
    expect(c.out.join("")).toMatch(/^paid-lock \d+\.\d+\.\d+/);
  });

  it("prints help with no arguments", () => {
    const c = capture();
    expect(main([], c.io)).toBe(EXIT.allowed);
    expect(c.out.join("")).toContain("Usage: paid-lock");
  });

  it("returns the tool-error exit code for an unknown command", () => {
    const c = capture();
    expect(main(["frobnicate"], c.io)).toBe(EXIT.toolError);
    expect(c.err.join("")).toContain("unknown command");
  });

  it("returns the tool-error exit code for commands not built yet", () => {
    const c = capture();
    expect(main(["verify"], c.io)).toBe(EXIT.toolError);
    expect(c.err.join("")).toContain("not available yet");
  });

  it("keeps the documented exit codes stable", () => {
    expect(EXIT).toEqual({ allowed: 0, blocked: 1, needsOk: 2, toolError: 3 });
  });
});
