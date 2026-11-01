// Written with AI help.
// Turn an unpaid HTTP response into a core Observation. Header names are compared lowercase.
// Precedence: a PAYMENT-REQUIRED header (x402 v2) wins; if it is present but unreadable the result
// is unreadable (no fallback to the body, which would let a seller show two different offers).
import type { Observation } from "@paid-lock/core";
import { X402_V2_PAYMENT_REQUIRED_HEADER } from "./headers.ts";
import { parseX402V1Body, parseX402V2Header, type ParseResult } from "./x402.ts";

export interface UnpaidResponse {
  status: number;
  /** Lowercased header names. */
  headers: Readonly<Record<string, string | undefined>>;
  body: string;
}

function toObservation(r: ParseResult): Observation {
  return r.ok ? { kind: "terms", terms: r.terms } : { kind: "unreadable", reason: r.reason };
}

export function observe402(res: UnpaidResponse): Observation {
  if (res.status !== 402) return { kind: "not402", status: res.status };
  const header = res.headers[X402_V2_PAYMENT_REQUIRED_HEADER.toLowerCase()];
  if (header !== undefined) return toObservation(parseX402V2Header(header));
  return toObservation(parseX402V1Body(res.body));
}
