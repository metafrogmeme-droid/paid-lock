// Written with AI help.
// Amounts are atomic-unit decimal strings compared as bigint, never floats (CLAUDE.md §3 item 1).

/** Decimal digits, no sign, no leading zeros, at most 78 digits (fits uint256). */
export const AMOUNT_PATTERN = /^(?:0|[1-9][0-9]{0,77})$/;

/** Largest tolerance accepted at `add` time: +100%. */
export const MAX_TOLERANCE_BPS = 10_000;

export function isAmount(value: string): boolean {
  return AMOUNT_PATTERN.test(value);
}

/** Cap = floor(amount * (10000 + bps) / 10000). `--tolerance 10%` is 1000 bps. */
export function applyTolerance(amount: string, bps: number): string {
  if (!isAmount(amount)) throw new RangeError("amount must be an atomic-unit decimal string");
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_TOLERANCE_BPS) {
    throw new RangeError(`tolerance must be a whole number of basis points from 0 to ${String(MAX_TOLERANCE_BPS)}`);
  }
  return ((BigInt(amount) * BigInt(10_000 + bps)) / 10_000n).toString();
}
