// Read-only MPP parser: `WWW-Authenticate: Payment` challenges of a 402 (docs/SPEC_SOURCES.md, MPP section:
// draft-httpauth-payment-01 §5.1, draft-payment-intent-charge-00 §5, mpp.dev/protocol/challenges).
// It never builds credentials. Mapping onto the lock's option fields: DECISIONS D-027, LOCK_FORMAT.md.
import { canonicalize, isJsonObject, type JsonObject, type ObservedTerms, type PaymentOption } from "@paid-lock/core";
import { z } from "zod";
import { decodeBase64Strict, MAX_HEADER_BYTES, parseJsonGuarded, type Refused } from "./guard.ts";

const MAX_CHALLENGES = 64;
// RFC 9110 §5.6.2 tchar, §11.2 token68.
const TCHAR = /[!#$%&'*+\-.^_`|~0-9A-Za-z]/u;
const TOKEN68 = /^[A-Za-z0-9\-._~+/]+=*/u;

export interface Challenge {
  /** Lowercased auth-scheme. */
  scheme: string;
  /** Auth-param names lowercased (they are case-insensitive), values unquoted. */
  params: Record<string, string>;
  token68?: string;
}

export type ChallengesResult = { ok: true; challenges: Challenge[] } | Refused;

/** Parse a WWW-Authenticate field value: a comma-separated list of challenges (RFC 9110 §11.6.1). */
export function parseChallenges(header: string): ChallengesResult {
  const fail = (reason: string): Refused => ({ ok: false, reason: `WWW-Authenticate: ${reason}` });
  let i = 0;
  const ows = (): void => {
    while (header[i] === " " || header[i] === "\t") i += 1;
  };
  const token = (): string => {
    const start = i;
    while (i < header.length && TCHAR.test(header.charAt(i))) i += 1;
    return header.slice(start, i);
  };
  /** After a comma: is the next element an auth-param (token BWS "=") rather than a new challenge? */
  const paramAhead = (): boolean => {
    let j = i;
    while (j < header.length && TCHAR.test(header.charAt(j))) j += 1;
    if (j === i) return false;
    while (header[j] === " " || header[j] === "\t") j += 1;
    return header[j] === "=";
  };
  const quoted = (): string | Refused => {
    let out = "";
    i += 1;
    while (i < header.length) {
      const ch = header.charAt(i);
      if (ch === '"') {
        i += 1;
        return out;
      }
      if (ch === "\\") {
        i += 1;
        if (i >= header.length) break;
      }
      const code = header.charCodeAt(i);
      if ((code < 0x20 && code !== 0x09) || code === 0x7f) return fail("control character in a quoted string");
      out += header.charAt(i);
      i += 1;
    }
    return fail("unterminated quoted string");
  };

  const challenges: Challenge[] = [];
  for (;;) {
    while (header[i] === "," || header[i] === " " || header[i] === "\t") i += 1;
    if (i >= header.length) break;
    if (challenges.length >= MAX_CHALLENGES) return fail("too many challenges");
    const scheme = token();
    if (scheme === "") return fail("expected an auth-scheme");
    const c: Challenge = { scheme: scheme.toLowerCase(), params: {} };
    challenges.push(c);
    if (header[i] !== " " && header[i] !== "\t") {
      if (i < header.length && header[i] !== ",") return fail("expected a space after the auth-scheme");
      continue;
    }
    ows();
    const t68 = TOKEN68.exec(header.slice(i));
    if (t68 !== null) {
      let j = i + t68[0].length;
      while (header[j] === " " || header[j] === "\t") j += 1;
      if (j >= header.length || header[j] === ",") {
        c.token68 = t68[0];
        i = j;
        continue;
      }
    }
    for (;;) {
      if (i >= header.length || header[i] === ",") break;
      const name = token().toLowerCase();
      if (name === "") return fail("expected an auth-param name");
      ows();
      if (header[i] !== "=") return fail(`expected "=" after ${name.slice(0, 40)}`);
      i += 1;
      ows();
      let value: string;
      if (header[i] === '"') {
        const q = quoted();
        if (typeof q !== "string") return q;
        value = q;
      } else {
        value = token();
        if (value === "") return fail(`missing value for ${name.slice(0, 40)}`);
      }
      if (Object.hasOwn(c.params, name)) return fail(`duplicate auth-param ${name.slice(0, 40)}`);
      c.params[name] = value;
      ows();
      if (i >= header.length) break;
      if (header[i] !== ",") return fail("expected a comma between auth-params");
      // A comma ends this param; the next element is either another param or the next challenge.
      let k = i;
      while (header[k] === "," || header[k] === " " || header[k] === "\t") k += 1;
      const save = i;
      i = k;
      if (!paramAhead()) {
        i = save;
        break;
      }
    }
  }
  return { ok: true, challenges };
}

/** draft-payment-intent-charge-00 §5: shared request fields of the "charge" intent. */
const ChargeRequest = z.looseObject({
  amount: z.string(),
  currency: z.string().min(1),
  recipient: z.string().min(1).optional(),
  description: z.string().optional(),
  externalId: z.string().optional(),
  methodDetails: z.record(z.string(), z.json()).optional(),
});
/** Display-only or per-order request fields: not part of the pinned terms. */
const NOT_TERMS = new Set(["amount", "currency", "recipient", "description", "externalId", "methodDetails"]);
/** Lowercase ASCII (draft §5.1), and short enough to be a CAIP-2 reference in `mpp:<method>`. */
const METHOD = /^[a-z0-9_-]{1,32}$/u;
const BASE64URL_NOPAD = /^[A-Za-z0-9_-]+$/u;

type OptionResult = { ok: true; option: PaymentOption } | Refused;

function decodeRequest(value: string): { ok: true; request: JsonObject } | Refused {
  if (!BASE64URL_NOPAD.test(value) || value.length % 4 === 1) {
    return { ok: false, reason: "MPP request is not unpadded base64url" };
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const decoded = decodeBase64Strict(padded, MAX_HEADER_BYTES);
  if (!decoded.ok) return { ok: false, reason: `MPP request: ${decoded.reason}` };
  const json = parseJsonGuarded(decoded.text, MAX_HEADER_BYTES);
  if (!json.ok) return { ok: false, reason: `MPP request: ${json.reason}` };
  if (!isJsonObject(json.value)) return { ok: false, reason: "MPP request is not a JSON object" };
  // The draft requires JCS (RFC 8785): any other serialisation of the same terms is refused, so two
  // parsers cannot read different terms from one challenge.
  if (canonicalize(json.value) !== decoded.text) return { ok: false, reason: "MPP request is not JCS (RFC 8785)" };
  return { ok: true, request: json.value };
}

function toOption(c: Challenge): OptionResult {
  if (c.token68 !== undefined) return { ok: false, reason: "MPP challenge has token68 instead of auth-params" };
  const p = c.params;
  for (const name of ["id", "realm", "method", "intent", "request"] as const) {
    if (!p[name]) return { ok: false, reason: `MPP challenge has no ${name}` };
  }
  const { realm = "", method = "", intent = "", request = "" } = p;
  if (!METHOD.test(method)) return { ok: false, reason: "MPP method is not a lowercase ASCII identifier" };
  if (intent !== "charge")
    return { ok: false, reason: `MPP intent "${intent.slice(0, 40)}" is not one paid.lock reads` };
  const decoded = decodeRequest(request);
  if (!decoded.ok) return decoded;
  const r = ChargeRequest.safeParse(decoded.request);
  if (!r.success) {
    const first = r.error.issues[0];
    return {
      ok: false,
      reason: `MPP charge request: ${first ? `${first.path.join(".") || "(root)"} ${first.message}` : "invalid"}`,
    };
  }
  const otherFields = Object.fromEntries(Object.entries(decoded.request).filter(([k]) => !NOT_TERMS.has(k)));
  return {
    ok: true,
    option: {
      scheme: intent,
      network: `mpp:${method}`,
      asset: r.data.currency,
      // Without a recipient the money goes to whoever runs the realm: pin the realm in its place (D-027).
      payTo: r.data.recipient ?? `realm:${realm}`,
      amount: r.data.amount,
      maxTimeoutSeconds: 0,
      paymentFlow: "authorization",
      assetTransferMethod: null,
      extra: { realm, ...(r.data.methodDetails === undefined ? {} : { methodDetails: r.data.methodDetails }) },
      otherFields: otherFields,
    },
  };
}

export type MppRead =
  { kind: "none" } | { kind: "terms"; terms: ObservedTerms } | { kind: "unreadable"; reason: string };

/**
 * MPP terms from a WWW-Authenticate value. `none` when it has no Payment challenge. The request URL
 * becomes `resourceUrl` (a challenge names none). id, expires, opaque, digest, description, header and
 * unknown auth-params are per-challenge or display-only and are left out (draft §5.1, §5.1.2.1).
 */
export function readMpp(header: string, requestUrl: string): MppRead {
  if (new TextEncoder().encode(header).length > MAX_HEADER_BYTES) {
    return { kind: "unreadable", reason: "WWW-Authenticate is too large" };
  }
  const parsed = parseChallenges(header);
  if (!parsed.ok) {
    // A malformed field that mentions the Payment scheme is unreadable; otherwise it is not ours.
    return /(^|[\s,])payment(\s|,|$)/iu.test(header) ? { kind: "unreadable", reason: parsed.reason } : { kind: "none" };
  }
  const payment = parsed.challenges.filter((c) => c.scheme === "payment");
  if (payment.length === 0) return { kind: "none" };
  const options: PaymentOption[] = [];
  for (const c of payment) {
    const o = toOption(c);
    if (!o.ok) return { kind: "unreadable", reason: o.reason };
    options.push(o.option);
  }
  return { kind: "terms", terms: { protocol: "mpp", resourceUrl: requestUrl, options, envelope: {} } };
}
