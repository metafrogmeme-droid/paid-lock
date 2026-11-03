// Written with AI help.
// Turn an unpaid HTTP response into a core Observation. Header names are compared lowercase.
// Precedence: a PAYMENT-REQUIRED header (x402 v2), else MPP Payment challenges in WWW-Authenticate,
// else the x402 v1 body. A header that is present but unreadable makes the result unreadable (no
// fallback, which would let a seller show two different offers), and a response that offers both
// x402 and MPP terms is unreadable too: paid.lock cannot know which one the client will pay (D-027).
import type { Observation } from "@paid-lock/core";
import { X402_V2_PAYMENT_REQUIRED_HEADER } from "./headers.ts";
import { readMpp, type MppRead } from "./mpp.ts";
import { parseX402V1Body, parseX402V2Header, type ParseResult } from "./x402.ts";

export interface UnpaidResponse {
  status: number;
  /** Lowercased header names. */
  headers: Readonly<Record<string, string | undefined>>;
  body: string;
  /** The URL that was requested. Needed for MPP terms, whose challenges name no resource URL. */
  url?: string;
}

function toObservation(r: ParseResult): Observation {
  return r.ok ? { kind: "terms", terms: r.terms } : { kind: "unreadable", reason: r.reason };
}

const BOTH: Observation = { kind: "unreadable", reason: "the response offers both x402 and MPP payment terms" };

export function observe402(res: UnpaidResponse): Observation {
  if (res.status !== 402) return { kind: "not402", status: res.status };
  const header = res.headers[X402_V2_PAYMENT_REQUIRED_HEADER.toLowerCase()];
  const auth = res.headers["www-authenticate"];
  const mpp: MppRead = auth === undefined ? { kind: "none" } : readMpp(auth, res.url ?? "");
  if (header !== undefined) return mpp.kind === "none" ? toObservation(parseX402V2Header(header)) : BOTH;
  if (mpp.kind === "none") return toObservation(parseX402V1Body(res.body));
  if (res.body.trim() !== "" && parseX402V1Body(res.body).ok) return BOTH;
  if (mpp.kind === "unreadable") return { kind: "unreadable", reason: mpp.reason };
  if (res.url === undefined) return { kind: "unreadable", reason: "MPP terms need the request URL" };
  return { kind: "terms", terms: mpp.terms };
}
