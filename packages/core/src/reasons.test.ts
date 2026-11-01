// Written with AI help.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decode, isReasonCode, REASONS, TIGHTENABLE, verdictOf, type ReasonCode } from "./reasons.ts";
import { VERDICTS } from "./verdict.ts";

const BLOCKED: ReasonCode[] = [
  "PAYTO_CHANGED",
  "NETWORK_CHANGED",
  "ASSET_CHANGED",
  "SCHEME_CHANGED",
  "PRICE_ABOVE_LOCK",
  "PAYMENT_FLOW_CHANGED",
  "RESOURCE_URL_MISMATCH",
  "REQUIREMENTS_UNREADABLE",
  "NOT_IN_LOCK",
];
const NEEDS_OK: ReasonCode[] = [
  "TERMS_CHANGED_OTHER",
  "NEW_OPTION_OFFERED",
  "ENDPOINT_NOT_402",
  "PROBE_TIMEOUT",
  "PROTOCOL_VERSION_CHANGED",
  "OPTION_REMOVED",
];

describe("reason codes", () => {
  it("has exactly the codes of CLAUDE.md §3 item 2 plus PROTOCOL_VERSION_CHANGED (P-01) and OPTION_REMOVED (#11)", () => {
    expect(Object.keys(REASONS).sort()).toEqual(["OK", ...BLOCKED, ...NEEDS_OK].sort());
  });

  it("maps OK to allowed", () => {
    expect(verdictOf("OK")).toBe("allowed");
    expect(decode("OK")).toBe("Allowed: within your limits");
  });

  it.each(BLOCKED)("maps %s to blocked", (code) => {
    expect(verdictOf(code)).toBe("blocked");
    expect(decode(code).startsWith("Blocked by your rule: ")).toBe(true);
  });

  it.each(NEEDS_OK)("maps %s to needs-your-OK", (code) => {
    expect(verdictOf(code)).toBe("needsOk");
    expect(decode(code).startsWith("Needs your OK: ")).toBe(true);
  });

  it("decodes PAYTO_CHANGED with the wording from the brief", () => {
    expect(decode("PAYTO_CHANGED")).toBe("Blocked by your rule: payTo changed since paid.lock");
  });

  it("fails closed on an unknown code", () => {
    expect(isReasonCode("NOPE")).toBe(false);
    expect(verdictOf("NOPE")).toBe("blocked");
    expect(decode("NOPE")).toBe("Blocked by your rule: unknown reason code");
    expect(decode("__proto__")).toBe("Blocked by your rule: unknown reason code");
  });

  it("only needs-your-OK codes can be tightened (nothing loosens a block)", () => {
    expect([...TIGHTENABLE].sort()).toEqual([...NEEDS_OK].sort());
  });

  it("property: decode returns one of the three verdict strings for any input", () => {
    fc.assert(
      fc.property(fc.oneof(fc.constantFrom(...Object.keys(REASONS)), fc.string()), (code) => {
        const line = decode(code);
        const prefixes = Object.values(VERDICTS).map((v) => v.prefix);
        expect(prefixes.filter((p) => line.startsWith(p))).toHaveLength(1);
      }),
    );
  });
});
