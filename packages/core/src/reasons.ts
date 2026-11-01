// Written with AI help.
// Stable reason codes (CLAUDE.md §3 item 2; PROTOCOL_VERSION_CHANGED added by approved P-01).
// Every code maps to exactly one of the three verdicts; unknown codes fail closed to blocked.
import { verdictLine, type Verdict } from "./verdict.ts";

export const REASONS = {
  OK: { verdict: "allowed", detail: "" },
  PAYTO_CHANGED: { verdict: "blocked", detail: "payTo changed since paid.lock" },
  NETWORK_CHANGED: { verdict: "blocked", detail: "network changed since paid.lock" },
  ASSET_CHANGED: { verdict: "blocked", detail: "asset changed since paid.lock" },
  SCHEME_CHANGED: { verdict: "blocked", detail: "scheme changed since paid.lock" },
  PRICE_ABOVE_LOCK: { verdict: "blocked", detail: "price is above the maximum in paid.lock" },
  PAYMENT_FLOW_CHANGED: { verdict: "blocked", detail: "payment flow changed since paid.lock" },
  RESOURCE_URL_MISMATCH: { verdict: "blocked", detail: "the 402 names a different resource URL than paid.lock" },
  REQUIREMENTS_UNREADABLE: { verdict: "blocked", detail: "payment requirements could not be read" },
  NOT_IN_LOCK: { verdict: "blocked", detail: "endpoint is not in paid.lock" },
  TERMS_CHANGED_OTHER: { verdict: "needsOk", detail: "other payment terms changed since paid.lock" },
  NEW_OPTION_OFFERED: { verdict: "needsOk", detail: "the seller offers a payment option that is not in paid.lock" },
  ENDPOINT_NOT_402: { verdict: "needsOk", detail: "endpoint did not answer 402 without payment" },
  PROBE_TIMEOUT: { verdict: "needsOk", detail: "endpoint did not answer in time" },
  PROTOCOL_VERSION_CHANGED: { verdict: "needsOk", detail: "protocol version changed since paid.lock" },
} as const satisfies Record<string, { verdict: Verdict; detail: string }>;

export type ReasonCode = keyof typeof REASONS;

export const REASON_CODES = Object.keys(REASONS) as ReasonCode[];

/** Codes an owner may tighten from "Needs your OK" to "Blocked". Nothing can loosen a block. */
export const TIGHTENABLE = REASON_CODES.filter((c) => REASONS[c].verdict === "needsOk");

export function isReasonCode(code: string): code is ReasonCode {
  return Object.hasOwn(REASONS, code);
}

export function verdictOf(code: string): Verdict {
  return isReasonCode(code) ? REASONS[code].verdict : "blocked";
}

/** The user-facing line for a code: always one of the three verdict strings. */
export function decode(code: string): string {
  if (!isReasonCode(code)) return verdictLine("blocked", "unknown reason code");
  const { verdict, detail } = REASONS[code];
  return verdict === "allowed" ? verdictLine("allowed") : verdictLine(verdict, detail);
}
