import type { ReasonCode } from "@paid-lock/core";

/** Longer help for `paid-lock explain <code>`. */
export const EXPLAIN: Record<ReasonCode, string> = {
  OK: "The endpoint's terms match paid.lock and the price is within your maximum.",
  PAYTO_CHANGED:
    "The address that would receive the money is not the one in paid.lock. Review it; accept with paid-lock update only if you expected it.",
  NETWORK_CHANGED: "The payment would happen on another chain than the one in paid.lock.",
  ASSET_CHANGED: "The token (or currency) to pay with is not the one in paid.lock.",
  SCHEME_CHANGED: "The payment scheme (for example exact or upto) is not the one in paid.lock.",
  PRICE_ABOVE_LOCK: "The amount asked is above policy.maxAmount in paid.lock. A lower price is always allowed.",
  PAYMENT_FLOW_CHANGED:
    "The payment flow changed (for example from authorization, settled after the resource runs, to upfront).",
  RESOURCE_URL_MISMATCH: "The 402 names a different resource URL than paid.lock. Path and query are compared exactly.",
  REQUIREMENTS_UNREADABLE:
    "The payment terms could not be read: malformed, ambiguous (for example duplicate keys) or an unknown payment flow or network. paid.lock fails closed.",
  NOT_IN_LOCK: "The endpoint is not in paid.lock. Add it with paid-lock add after reviewing its terms.",
  TERMS_CHANGED_OTHER:
    "Other terms changed (for example extra fields, maxTimeoutSeconds or extensions), or two identical requests saw different terms.",
  NEW_OPTION_OFFERED:
    "The seller offers an extra payment option that is not in paid.lock. The locked options are unchanged.",
  ENDPOINT_NOT_402:
    "The endpoint did not answer 402 without payment (for example 200, 404, a redirect, or no answer). Redirects are never followed.",
  PROBE_TIMEOUT: "The endpoint did not answer within the time limit.",
  PROTOCOL_VERSION_CHANGED: "The endpoint now speaks another x402 version than the one in paid.lock.",
  OPTION_REMOVED: "A payment option in paid.lock is no longer offered. The remaining options were still checked.",
};
