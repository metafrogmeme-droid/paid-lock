// Turn an unpaid HTTP response into a core Observation. Header names are compared lowercase.
// Precedence: a PAYMENT-REQUIRED header (x402 v2), else MPP Payment challenges in WWW-Authenticate,
// else the x402 v1 body. A header that is present but unreadable makes the result unreadable (no
// fallback, which would let a seller show two different offers), and a response that offers both
// x402 and MPP terms, or an x402 header plus a different v1 body, is unreadable too: paid.lock cannot know
// which one the client will pay (D-027, review M1).
import { canonicalize, normalizeTerms, type Json, type Observation, type ObservedTerms } from "@paid-lock/core";
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

const BOTH: Observation = { kind: "unreadable", reason: "the response offers more than one set of payment terms" };

/** Whether the body holds readable x402 v1 terms (a second offer next to MPP challenges is ambiguous). */
function hasV1Body(body: string): boolean {
  return body.trim() !== "" && parseX402V1Body(body).ok;
}

/** The options and resource URL a client would agree to, normalised; undefined when unreadable. */
function offer(terms: ObservedTerms): string | undefined {
  const n = normalizeTerms(terms);
  return n.ok
    ? canonicalize({ resourceUrl: n.terms.resourceUrl, options: n.terms.options } as unknown as Json)
    : undefined;
}

/**
 * An x402 v2 header, and a v1 body only if it offers exactly the same terms. The x402 transport puts v2 terms
 * in the header only, but a server may repeat them in a v1 body for old clients; a v1 body that offers
 * anything else is a second, different offer, which is unreadable (review M1).
 */
function fromHeader(header: string, body: string): Observation {
  const v2 = toObservation(parseX402V2Header(header));
  if (v2.kind !== "terms" || body.trim() === "") return v2;
  const v1 = parseX402V1Body(body);
  if (!v1.ok) return v2;
  const a = offer(v2.terms);
  return a !== undefined && a === offer(v1.terms) ? v2 : BOTH;
}

export function observe402(res: UnpaidResponse): Observation {
  if (res.status !== 402) return { kind: "not402", status: res.status };
  const header = res.headers[X402_V2_PAYMENT_REQUIRED_HEADER.toLowerCase()];
  const auth = res.headers["www-authenticate"];
  const mpp: MppRead = auth === undefined ? { kind: "none" } : readMpp(auth, res.url ?? "");
  if (header !== undefined) return mpp.kind === "none" ? fromHeader(header, res.body) : BOTH;
  if (mpp.kind === "none") return toObservation(parseX402V1Body(res.body));
  if (hasV1Body(res.body)) return BOTH;
  if (mpp.kind === "unreadable") return { kind: "unreadable", reason: mpp.reason };
  if (res.url === undefined) return { kind: "unreadable", reason: "MPP terms need the request URL" };
  return { kind: "terms", terms: mpp.terms };
}
