import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyTolerance, isAmount, MAX_TOLERANCE_BPS } from "./amount.ts";

describe("amounts (atomic units, bigint strings)", () => {
  it.each(["0", "1", "10000", "115792089237316195423570985008687907853269984665640564039457584007913129639935"])(
    "accepts %s",
    (a) => {
      expect(isAmount(a)).toBe(true);
    },
  );

  it.each(["", "01", "-1", "1.5", "1e3", " 1", "0x10", "+1", "1".repeat(79)])("rejects %j", (a) => {
    expect(isAmount(a)).toBe(false);
  });

  it("applies a tolerance in basis points, rounding down", () => {
    expect(applyTolerance("10000", 1000)).toBe("11000");
    expect(applyTolerance("10000", 0)).toBe("10000");
    expect(applyTolerance("999", 1000)).toBe("1098");
  });

  it("rejects a negative, fractional or absurd tolerance and a bad amount", () => {
    expect(() => applyTolerance("10000", -1)).toThrow(RangeError);
    expect(() => applyTolerance("10000", 0.5)).toThrow(RangeError);
    expect(() => applyTolerance("10000", MAX_TOLERANCE_BPS + 1)).toThrow(RangeError);
    expect(() => applyTolerance("1.5", 10)).toThrow(RangeError);
  });

  it("property: the cap is never below the observed amount", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 2n ** 256n - 1n }),
        fc.integer({ min: 0, max: MAX_TOLERANCE_BPS }),
        (a, bps) => {
          expect(BigInt(applyTolerance(a.toString(), bps)) >= a).toBe(true);
        },
      ),
    );
  });
});
