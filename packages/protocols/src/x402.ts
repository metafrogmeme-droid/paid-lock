// Written with AI help.
// Read-only x402 parsers. Field names trace to docs/SPEC_SOURCES.md (x402 @ e208bd3):
//   v2: specs/x402-specification-v2.md §5.1 + specs/transports-v2/http.md (PAYMENT-REQUIRED header, Base64)
//   v1: specs/x402-specification-v1.md §5.1 + specs/transports-v1/http.md (JSON body)
// Output is core ObservedTerms; the core normalises and validates it (fail closed).
import { isJsonObject, type JsonObject, type ObservedTerms, type PaymentOption } from "@paid-lock/core";
import { z } from "zod";
import { decodeBase64Strict, MAX_BODY_BYTES, MAX_HEADER_BYTES, parseJsonGuarded, type Refused } from "./guard.ts";
import { v1NetworkToCaip2 } from "./networks.ts";

export type ParseResult = { ok: true; terms: ObservedTerms } | Refused;

const MAX_OPTIONS = 64;
const JsonRecord = z.record(z.string(), z.json());

const RequirementsV2 = z.looseObject({
  scheme: z.string(),
  network: z.string(),
  amount: z.string(),
  asset: z.string(),
  payTo: z.string(),
  maxTimeoutSeconds: z.number(),
  extra: JsonRecord.optional(),
});
const KNOWN_V2_REQ = new Set(["scheme", "network", "amount", "asset", "payTo", "maxTimeoutSeconds", "extra"]);

const PaymentRequiredV2 = z.looseObject({
  x402Version: z.literal(2),
  error: z.string().optional(),
  resource: z.looseObject({ url: z.string() }),
  accepts: z.array(RequirementsV2).min(1).max(MAX_OPTIONS),
  extensions: JsonRecord.optional(),
});
const KNOWN_V2_TOP = new Set(["x402Version", "error", "resource", "accepts", "extensions"]);

const RequirementsV1 = z.looseObject({
  scheme: z.string(),
  network: z.string(),
  maxAmountRequired: z.string(),
  asset: z.string(),
  payTo: z.string(),
  resource: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  outputSchema: z.json().optional(),
  maxTimeoutSeconds: z.number(),
  extra: JsonRecord.nullable().optional(),
});
// description, mimeType and outputSchema are descriptive: known, but not part of the terms.
const KNOWN_V1_REQ = new Set([
  "scheme",
  "network",
  "maxAmountRequired",
  "asset",
  "payTo",
  "resource",
  "description",
  "mimeType",
  "outputSchema",
  "maxTimeoutSeconds",
  "extra",
]);

const PaymentRequiredV1 = z.looseObject({
  x402Version: z.literal(1),
  error: z.string().optional(),
  accepts: z.array(RequirementsV1).min(1).max(MAX_OPTIONS),
});
const KNOWN_V1_TOP = new Set(["x402Version", "error", "accepts"]);

/**
 * Extension fields that change on every request (docs/LOCK_FORMAT.md, "Envelope hash"):
 * sign-in-with-x challenge metadata, and the whole offer-receipt extension (signed restatement of
 * accepts[] with per-offer expiry; the terms it signs are pinned directly).
 */
const SIWX_VOLATILE = ["nonce", "issuedAt", "expirationTime", "notBefore", "requestId"];

export function stableExtensions(extensions: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [name, ext] of Object.entries(extensions)) {
    if (name === "offer-receipt") continue;
    const info = isJsonObject(ext) ? ext["info"] : undefined;
    if (name === "sign-in-with-x" && isJsonObject(ext) && isJsonObject(info)) {
      out[name] = {
        ...ext,
        info: Object.fromEntries(Object.entries(info).filter(([k]) => !SIWX_VOLATILE.includes(k))),
      };
      continue;
    }
    out[name] = ext;
  }
  return out;
}

function pick(obj: Record<string, unknown>, known: ReadonlySet<string>): JsonObject {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !known.has(k))) as JsonObject;
}

type ExtraSplit = { ok: true; paymentFlow: string; assetTransferMethod: string | null; extra: JsonObject } | Refused;

/** Split the protocol-reserved keys (v2 §6.1) out of `extra`; a non-string value is unreadable. */
function splitExtra(extra: JsonObject | null | undefined): ExtraSplit {
  const { paymentFlow, assetTransferMethod, ...rest } = extra ?? {};
  if (paymentFlow !== undefined && typeof paymentFlow !== "string")
    return { ok: false, reason: "extra.paymentFlow is not a string" };
  if (assetTransferMethod !== undefined && typeof assetTransferMethod !== "string") {
    return { ok: false, reason: "extra.assetTransferMethod is not a string" };
  }
  return {
    ok: true,
    paymentFlow: paymentFlow ?? "authorization",
    assetTransferMethod: assetTransferMethod ?? null,
    extra: rest,
  };
}

function zodReason(prefix: string, error: z.ZodError): Refused {
  const first = error.issues[0];
  return {
    ok: false,
    reason: `${prefix}: ${first ? `${first.path.join(".") || "(root)"} ${first.message}` : "invalid"}`,
  };
}

/** x402 v2: the value of the PAYMENT-REQUIRED response header. */
export function parseX402V2Header(header: string): ParseResult {
  const decoded = decodeBase64Strict(header, MAX_HEADER_BYTES);
  if (!decoded.ok) return decoded;
  const json = parseJsonGuarded(decoded.text, MAX_HEADER_BYTES);
  if (!json.ok) return json;
  return fromV2Json(json.value);
}

/** x402 v2 PaymentRequired from JSON that already passed the input guards. */
export function fromV2Json(value: unknown): ParseResult {
  const r = PaymentRequiredV2.safeParse(value);
  if (!r.success) return zodReason("x402 v2", r.error);
  const options: PaymentOption[] = [];
  for (const req of r.data.accepts) {
    const extra = splitExtra(req.extra);
    if (!extra.ok) return extra;
    options.push({
      scheme: req.scheme,
      network: req.network,
      asset: req.asset,
      payTo: req.payTo,
      amount: req.amount,
      maxTimeoutSeconds: req.maxTimeoutSeconds,
      paymentFlow: extra.paymentFlow,
      assetTransferMethod: extra.assetTransferMethod,
      extra: extra.extra,
      otherFields: pick(req, KNOWN_V2_REQ),
    });
  }
  return {
    ok: true,
    terms: {
      protocol: "x402",
      x402Version: 2,
      resourceUrl: r.data.resource.url,
      options,
      envelope: {
        extensions: stableExtensions(r.data.extensions ?? {}),
        otherFields: pick(r.data, KNOWN_V2_TOP),
      },
    },
  };
}

/** x402 v1: the JSON body of the 402 response. */
export function parseX402V1Body(body: string): ParseResult {
  const json = parseJsonGuarded(body, MAX_BODY_BYTES);
  if (!json.ok) return json;
  return fromV1Json(json.value);
}

/** x402 v1 body from JSON that already passed the input guards. */
export function fromV1Json(value: unknown): ParseResult {
  const r = PaymentRequiredV1.safeParse(value);
  if (!r.success) return zodReason("x402 v1", r.error);
  const resources = new Set(r.data.accepts.map((a) => a.resource));
  const [resourceUrl] = resources;
  if (resources.size !== 1 || resourceUrl === undefined)
    return { ok: false, reason: "x402 v1: accepts name different resources" };
  const options: PaymentOption[] = [];
  for (const req of r.data.accepts) {
    const network = v1NetworkToCaip2(req.network);
    if (network === undefined)
      return { ok: false, reason: `x402 v1: unknown network name "${req.network.slice(0, 40)}"` };
    const extra = splitExtra(req.extra);
    if (!extra.ok) return extra;
    options.push({
      scheme: req.scheme,
      network,
      asset: req.asset,
      payTo: req.payTo,
      amount: req.maxAmountRequired,
      maxTimeoutSeconds: req.maxTimeoutSeconds,
      paymentFlow: extra.paymentFlow,
      assetTransferMethod: extra.assetTransferMethod,
      extra: extra.extra,
      otherFields: pick(req, KNOWN_V1_REQ),
    });
  }
  // v1 has no extensions; the envelope has the same shape as v2 so a version switch alone reads as one change.
  return {
    ok: true,
    terms: {
      protocol: "x402",
      x402Version: 1,
      resourceUrl,
      options,
      envelope: { extensions: {}, otherFields: pick(r.data, KNOWN_V1_TOP) },
    },
  };
}
