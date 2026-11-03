// Normalised payment terms: what the protocol parsers hand to the core, and what the lock stores.
// Field names follow x402 v2 PaymentRequirements (docs/SPEC_SOURCES.md); the parsers map v1 onto them.
import { normalizeAddress } from "./address.ts";
import { isAmount } from "./amount.ts";
import { integrityOf, type Integrity } from "./integrity.ts";
import { normalizeUrl } from "./url.ts";
import type { JsonObject } from "./json.ts";

export interface PaymentOption {
  scheme: string;
  /** CAIP-2. */
  network: string;
  asset: string;
  payTo: string;
  /** Atomic units. For `upto` this is the maximum the client would authorise. */
  amount: string;
  maxTimeoutSeconds: number;
  /** `extra.paymentFlow`, resolved: absent means `authorization` (x402 v2 §6.1). */
  paymentFlow: string;
  /** `extra.assetTransferMethod`, or null when absent. */
  assetTransferMethod: string | null;
  /** `extra` without the two protocol-reserved keys above. */
  extra: JsonObject;
  /** Keys of the accepts[] entry that x402 does not define, so drift in them is still visible. */
  otherFields: JsonObject;
}

export interface ObservedTerms {
  /** x402 (v2 header or v1 body) or MPP (`WWW-Authenticate: Payment` challenges, DECISIONS D-027). */
  protocol: "x402" | "mpp";
  /** x402 only: the pinned protocol version. MPP terms have none. */
  x402Version?: number;
  resourceUrl: string;
  options: PaymentOption[];
  /** Extensions with per-request fields removed, plus unknown top-level fields (set by the parser). */
  envelope: JsonObject;
}

/** Payment flows defined by x402 v2 §6.1. Clients MUST NOT pay a flow they do not recognise. */
export const PAYMENT_FLOWS: readonly string[] = ["authorization", "upfront", "escrow"];

/** CAIP-2 chain id: namespace (3-8 chars) ":" reference (1-32 chars). */
const CAIP2 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;
const ID_PART = /^[\x21-\x7e]+$/;

export type OptionId = string;

/** Identity of an option (approved P-01): scheme, network, asset, payTo. Order in accepts[] is irrelevant. */
export function optionId(o: Pick<PaymentOption, "scheme" | "network" | "asset" | "payTo">): OptionId {
  return `${o.scheme} ${o.network} ${o.asset} ${o.payTo}`;
}

/**
 * Terms hash of one option (approved P-01): SHA-256 over RFC 8785 JCS of a fixed field list,
 * every field except `amount` (the price is checked against the owner's policy instead, so a
 * price drop never changes the hash). The list is documented in docs/LOCK_FORMAT.md.
 */
export function optionIntegrity(o: PaymentOption): Integrity {
  return integrityOf({
    scheme: o.scheme,
    network: o.network,
    asset: o.asset,
    payTo: o.payTo,
    maxTimeoutSeconds: o.maxTimeoutSeconds,
    paymentFlow: o.paymentFlow,
    assetTransferMethod: o.assetTransferMethod,
    extra: o.extra,
    otherFields: o.otherFields,
  });
}

export type NormalizeResult = { ok: true; terms: ObservedTerms } | { ok: false; reason: string };

function normalizeOption(o: PaymentOption): { ok: true; option: PaymentOption } | { ok: false; reason: string } {
  if (!CAIP2.test(o.network)) return { ok: false, reason: "network is not a CAIP-2 chain id" };
  if (!ID_PART.test(o.scheme)) return { ok: false, reason: "scheme is empty or has spaces" };
  if (!isAmount(o.amount)) return { ok: false, reason: "amount is not an atomic-unit integer string" };
  if (!Number.isSafeInteger(o.maxTimeoutSeconds) || o.maxTimeoutSeconds < 0) {
    return { ok: false, reason: "maxTimeoutSeconds is not a non-negative integer" };
  }
  if (!PAYMENT_FLOWS.includes(o.paymentFlow)) return { ok: false, reason: "payment flow is not one x402 defines" };
  const asset = normalizeAddress(o.network, o.asset);
  if (!asset.ok) return { ok: false, reason: `asset: ${asset.reason}` };
  const payTo = normalizeAddress(o.network, o.payTo);
  if (!payTo.ok) return { ok: false, reason: `payTo: ${payTo.reason}` };
  return { ok: true, option: { ...o, asset: asset.value, payTo: payTo.value } };
}

/**
 * Validate and normalise parsed terms. Fail closed: anything ambiguous (no options, two options
 * with the same identity, bad addresses, unknown payment flow) is refused and becomes
 * REQUIREMENTS_UNREADABLE upstream.
 */
export function normalizeTerms(t: ObservedTerms): NormalizeResult {
  if (t.protocol === "mpp" && t.x402Version !== undefined) {
    return { ok: false, reason: "x402Version is only valid for x402" };
  }
  const v = t.x402Version;
  if (t.protocol === "x402" && (v === undefined || !Number.isSafeInteger(v) || v < 1)) {
    return { ok: false, reason: "x402Version must be a positive integer" };
  }
  const url = normalizeUrl(t.resourceUrl);
  if (!url.ok) return { ok: false, reason: `resource URL: ${url.reason}` };
  const resourceUrl = url.value;
  if (t.options.length === 0) return { ok: false, reason: "no payment options" };
  const options: PaymentOption[] = [];
  const seen = new Set<OptionId>();
  for (const raw of t.options) {
    const r = normalizeOption(raw);
    if (!r.ok) return r;
    const id = optionId(r.option);
    if (seen.has(id)) return { ok: false, reason: "two payment options have the same identity" };
    seen.add(id);
    options.push(r.option);
  }
  options.sort((a, b) => (optionId(a) < optionId(b) ? -1 : 1));
  return { ok: true, terms: { ...t, resourceUrl, options } };
}
