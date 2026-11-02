// Written with AI help.
// paid.lock format v1 (approved P-01; spec in docs/LOCK_FORMAT.md):
//   - per endpoint, `observed` (what the probe saw; rewritten only by `paid-lock update`) and
//     `policy` (the owner's limits; never rewritten by the tool, only extended for new options);
//   - observed options keyed by identity (scheme, network, asset, payTo), each with its own
//     terms hash; no timestamps or tool versions, so the same input gives the same bytes.
import { z } from "zod";
import { normalizeAddress } from "./address.ts";
import { AMOUNT_PATTERN, applyTolerance } from "./amount.ts";
import { INTEGRITY_PATTERN, integrityOf } from "./integrity.ts";
import { MAX_DEPTH, prettyCanonical } from "./jcs.ts";
import type { Json, JsonObject } from "./json.ts";
import { TIGHTENABLE } from "./reasons.ts";
import { optionId, optionIntegrity, PAYMENT_FLOWS, type ObservedTerms, type PaymentOption } from "./terms.ts";
import { normalizeUrl } from "./url.ts";

export const LOCKFILE_VERSION = 1;
/** paid.lock files above this size are refused before parsing. */
export const MAX_LOCK_BYTES = 8 * 1024 * 1024;

export type Method = "GET" | "POST";

const IdPart = z.string().regex(/^[\x21-\x7e]+$/);
const Amount = z.string().regex(AMOUNT_PATTERN, "must be an atomic-unit integer string");
const IntegrityString = z.string().regex(INTEGRITY_PATTERN, "must be sha256-<base64>");
const JsonRecord = z.record(z.string(), z.json());

const LockedOptionSchema = z.strictObject({
  scheme: IdPart,
  network: IdPart,
  asset: IdPart,
  payTo: IdPart,
  amount: Amount,
  maxTimeoutSeconds: z.int().nonnegative(),
  paymentFlow: z.enum(PAYMENT_FLOWS as [string, ...string[]]),
  assetTransferMethod: z.string().min(1).nullable(),
  extra: JsonRecord,
  otherFields: JsonRecord,
  integrity: IntegrityString,
});

const ObservedSchema = z.strictObject({
  protocol: z.literal("x402"),
  x402Version: z.int().positive(),
  resourceUrl: z.url(),
  envelopeIntegrity: IntegrityString,
  options: z.record(z.string(), LockedOptionSchema),
});

const PolicySchema = z.strictObject({
  options: z.record(z.string(), z.strictObject({ maxAmount: Amount })),
  tighten: z.array(z.enum(TIGHTENABLE as [string, ...string[]])).optional(),
  /**
   * Owner opt-in (decision of 2 Nov 2026): allow probing this endpoint on a private, link-local or
   * loopback address. Only `true` is valid; remove the key to refuse again.
   */
  allowPrivateNetwork: z.literal(true).optional(),
});

const EndpointSchema = z.strictObject({ observed: ObservedSchema, policy: PolicySchema });

export const LockSchema = z
  .strictObject({
    lockfileVersion: z.literal(LOCKFILE_VERSION),
    endpoints: z.record(z.string().regex(/^(?:GET|POST) \S+$/), EndpointSchema),
  })
  .superRefine((lock, ctx) => {
    for (const [key, ep] of Object.entries(lock.endpoints)) {
      const issue = (message: string, ...path: string[]): void => {
        ctx.addIssue({ code: "custom", message, path: ["endpoints", key, ...path] });
      };
      const m = /^(GET|POST) (\S+)$/.exec(key);
      if (m?.[2] === undefined || normalUrl(m[2]) !== m[2]) issue('key must be "GET|POST <normalised absolute URL>"');
      if (normalUrl(ep.observed.resourceUrl) !== ep.observed.resourceUrl)
        issue("resource URL must be normalised", "observed", "resourceUrl");
      for (const [id, o] of Object.entries(ep.observed.options)) {
        const opt = o as unknown as PaymentOption & { integrity: string };
        if (optionId(opt) !== id) issue("key must equal the option identity", "observed", "options", id);
        if (optionIntegrity(opt) !== opt.integrity)
          issue("integrity does not match the option's fields", "observed", "options", id);
        for (const field of ["asset", "payTo"] as const) {
          const n = normalizeAddress(opt.network, opt[field]);
          if (!n.ok || n.value !== opt[field])
            issue("address must be normalised (EIP-55 on eip155)", "observed", "options", id, field);
        }
        if (!Object.hasOwn(ep.policy.options, id))
          issue("every observed option needs a policy entry", "policy", "options", id);
      }
      const tighten = ep.policy.tighten ?? [];
      if (new Set(tighten).size !== tighten.length) issue("tighten lists a code twice", "policy", "tighten");
    }
  })
  .meta({
    title: "paid.lock v1",
    description:
      "Lockfile pinning the payment terms of paid HTTP endpoints. Cross-field rules (identity keys, integrity, EIP-55, policy coverage) are in docs/LOCK_FORMAT.md.",
  });

export type Lock = z.infer<typeof LockSchema>;
export type LockedEndpoint = Lock["endpoints"][string];
export type LockedObserved = LockedEndpoint["observed"];

function normalUrl(url: string): string | undefined {
  const r = normalizeUrl(url);
  return r.ok ? r.value : undefined;
}

/** `"<METHOD> <URL>"` with the URL normalised by normalizeUrl (owner decision #10). Throws on a bad URL. */
export function endpointKey(method: Method, url: string): string {
  const r = normalizeUrl(url);
  if (!r.ok) throw new RangeError(r.reason);
  return `${method} ${r.value}`;
}

export function emptyLock(): Lock {
  return { lockfileVersion: LOCKFILE_VERSION, endpoints: {} };
}

/** Observed block from normalised terms (see normalizeTerms). */
export function observedFrom(t: ObservedTerms): LockedObserved {
  return {
    protocol: t.protocol,
    x402Version: t.x402Version,
    resourceUrl: t.resourceUrl,
    envelopeIntegrity: integrityOf(t.envelope),
    options: Object.fromEntries(t.options.map((o) => [optionId(o), { ...o, integrity: optionIntegrity(o) }])),
  };
}

/** A new endpoint entry (`paid-lock add`): policy maxAmount = observed amount + tolerance. */
export function newEndpoint(
  t: ObservedTerms,
  opts: { toleranceBps: number; allowPrivateNetwork?: boolean },
): LockedEndpoint {
  return {
    observed: observedFrom(t),
    policy: {
      options: Object.fromEntries(
        t.options.map((o) => [optionId(o), { maxAmount: applyTolerance(o.amount, opts.toleranceBps) }]),
      ),
      ...(opts.allowPrivateNetwork === true ? { allowPrivateNetwork: true as const } : {}),
    },
  };
}

export function serializeLock(lock: Lock): string {
  return prettyCanonical(lock as unknown as Json);
}

export type ParseLockResult = { ok: true; lock: Lock } | { ok: false; errors: string[] };

export function parseLock(text: string): ParseLockResult {
  if (new TextEncoder().encode(text).length > MAX_LOCK_BYTES) return { ok: false, errors: ["paid.lock is too large"] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["paid.lock is not valid JSON"] };
  }
  if (tooDeep(raw, MAX_DEPTH)) return { ok: false, errors: ["paid.lock is nested too deeply"] };
  const r = LockSchema.safeParse(raw);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  return { ok: true, lock: r.data };
}

/** True if `v` nests more than `limit` containers. Stops at the limit, so hostile input cannot exhaust the stack. */
function tooDeep(v: unknown, limit: number): boolean {
  if (v === null || typeof v !== "object") return false;
  if (limit === 0) return true;
  const children: unknown[] = Array.isArray(v) ? v : Object.values(v as JsonObject);
  return children.some((c) => tooDeep(c, limit - 1));
}

/** JSON Schema (draft 2020-12) of the lock, generated from the zod schema: schemas/paid.lock.v1.schema.json. */
export function lockJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(LockSchema, { target: "draft-2020-12" });
}
