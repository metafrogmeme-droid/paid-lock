import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { VERDICTS, verdictLine, type Verdict } from "./verdict.ts";

describe("verdictLine", () => {
  it("uses the fixed sentence for an allowed verdict", () => {
    expect(verdictLine("allowed")).toBe("Allowed: within your limits");
  });

  it("prefixes a blocked verdict with the fixed rule text", () => {
    expect(verdictLine("blocked", "payTo changed since paid.lock")).toBe(
      "Blocked by your rule: payTo changed since paid.lock",
    );
  });

  it("prefixes a needs-ok verdict with the fixed text", () => {
    expect(verdictLine("needsOk", "terms changed")).toBe("Needs your OK: terms changed");
  });

  it("ignores detail for allowed (the sentence never changes)", () => {
    expect(verdictLine("allowed", "anything")).toBe("Allowed: within your limits");
  });

  it("rejects an empty detail for blocked and needs-ok", () => {
    expect(() => verdictLine("blocked", "")).toThrow(/detail/);
    expect(() => verdictLine("needsOk", "   ")).toThrow(/detail/);
    expect(() => verdictLine("blocked")).toThrow(/detail/);
  });

  it("property: every line starts with one of exactly three prefixes", () => {
    const verdicts: readonly Verdict[] = ["allowed", "blocked", "needsOk"];
    fc.assert(
      fc.property(
        fc.constantFrom(...verdicts),
        fc.string({ minLength: 1 }).filter((s) => s.trim() !== ""),
        (verdict, detail) => {
          const line = verdictLine(verdict, detail);
          const matches = Object.values(VERDICTS).filter((v) => line.startsWith(v.prefix));
          expect(matches).toHaveLength(1);
        },
      ),
    );
  });

  it("property: detail is single-line (newlines become spaces) so CI logs cannot be spoofed", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim() !== ""),
        (detail) => {
          const line = verdictLine("blocked", detail);
          expect(line).not.toMatch(/[\r\n\u2028\u2029]/);
        },
      ),
    );
  });
});
