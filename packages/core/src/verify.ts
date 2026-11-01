// Written with AI help.
// verify: compare a fresh observation of one endpoint with paid.lock (observed + policy).
// Pure. Fail closed: anything unreadable or ambiguous is blocked; a locked option that vanished
// while another appeared is treated as that option having changed (blocked), never as harmless.
import { integrityOf } from "./integrity.ts";
import { canonicalize } from "./jcs.ts";
import type { Json } from "./json.ts";
import { observedFrom, type Lock, type LockedEndpoint } from "./lock.ts";
import { applyTolerance } from "./amount.ts";
import { REASONS, type ReasonCode } from "./reasons.ts";
import { normalizeTerms, optionId, type ObservedTerms, type PaymentOption } from "./terms.ts";
import { verdictLine, type Verdict } from "./verdict.ts";

/** What the probe (or a runtime hook) saw for one endpoint. */
export type Observation =
  | { kind: "terms"; terms: ObservedTerms }
  | { kind: "unreadable"; reason: string }
  /** status 0 = no HTTP response at all. `detail` never holds header values or bodies (CLAUDE.md §5 rule 13). */
  | { kind: "not402"; status: number; detail?: string }
  | { kind: "timeout" };

export interface Finding {
  code: ReasonCode;
  verdict: Verdict;
  /** One of the three verdict strings, single line. */
  line: string;
  option?: string;
}

export interface EndpointResult {
  key: string;
  verdict: Verdict;
  line: string;
  findings: Finding[];
  /** Information that changes no verdict, e.g. a price drop (owner decision #2: allowed but reported). */
  notes: string[];
}

const RANK: Record<Verdict, number> = { allowed: 0, needsOk: 1, blocked: 2 };
const MAX_VALUE_CHARS = 120;
const IDENTITY = ["scheme", "network", "asset", "payTo"] as const;
const IDENTITY_CODE: Record<(typeof IDENTITY)[number], ReasonCode> = {
  scheme: "SCHEME_CHANGED",
  network: "NETWORK_CHANGED",
  asset: "ASSET_CHANGED",
  payTo: "PAYTO_CHANGED",
};
const OTHER_FIELDS = ["maxTimeoutSeconds", "assetTransferMethod", "extra", "otherFields"] as const;

/** Seller-controlled text is clipped so it cannot flood logs (verdictLine also removes line breaks). */
function clip(value: string): string {
  return value.length > MAX_VALUE_CHARS ? `${value.slice(0, MAX_VALUE_CHARS)}...` : value;
}

function change(before: string, after: string): string {
  return `(${clip(before)} -> ${clip(after)})`;
}

class Collector {
  readonly findings: Finding[] = [];
  readonly notes: string[] = [];
  private readonly tighten: readonly string[];
  constructor(tighten: readonly string[]) {
    this.tighten = tighten;
  }

  add(code: ReasonCode, extra?: string, option?: string): void {
    const base = REASONS[code];
    const verdict: Verdict = base.verdict === "needsOk" && this.tighten.includes(code) ? "blocked" : base.verdict;
    const detail = extra === undefined ? base.detail : `${base.detail} ${extra}`;
    const finding: Finding = { code, verdict, line: verdictLine(verdict, detail) };
    if (option !== undefined) finding.option = option;
    this.findings.push(finding);
  }

  result(key: string): EndpointResult {
    const worst = this.findings.reduce<Verdict>((v, f) => (RANK[f.verdict] > RANK[v] ? f.verdict : v), "allowed");
    const first = this.findings.find((f) => f.verdict === worst);
    return {
      key,
      verdict: worst,
      line: first?.line ?? verdictLine("allowed"),
      findings: this.findings,
      notes: this.notes,
    };
  }
}

function sharedIdentity(a: PaymentOption, b: PaymentOption): number {
  return IDENTITY.filter((f) => a[f] === b[f]).length;
}

function compareOptions(c: Collector, locked: PaymentOption, seen: PaymentOption, maxAmount: string, id: string): void {
  if (BigInt(seen.amount) > BigInt(maxAmount)) c.add("PRICE_ABOVE_LOCK", `(${clip(seen.amount)} > ${maxAmount})`, id);
  else if (BigInt(seen.amount) < BigInt(locked.amount))
    c.notes.push(`price dropped for ${id} ${change(locked.amount, seen.amount)}`);
  if (seen.paymentFlow !== locked.paymentFlow)
    c.add("PAYMENT_FLOW_CHANGED", change(locked.paymentFlow, seen.paymentFlow), id);
  const changed = OTHER_FIELDS.filter((f) => canonicalize(locked[f] as Json) !== canonicalize(seen[f] as Json));
  if (changed.length > 0) c.add("TERMS_CHANGED_OTHER", `(changed: ${changed.join(", ")})`, id);
}

export function verifyEndpoint(lock: Lock, key: string, obs: Observation): EndpointResult {
  const ep: LockedEndpoint | undefined = lock.endpoints[key];
  const c = new Collector(ep?.policy.tighten ?? []);
  if (ep === undefined) {
    c.add("NOT_IN_LOCK");
    return c.result(key);
  }
  switch (obs.kind) {
    case "unreadable":
      c.add("REQUIREMENTS_UNREADABLE", `(${clip(obs.reason)})`);
      return c.result(key);
    case "not402":
      c.add(
        "ENDPOINT_NOT_402",
        obs.status === 0
          ? `(no HTTP response${obs.detail === undefined ? "" : `: ${clip(obs.detail)}`})`
          : `(HTTP ${String(obs.status)}${obs.detail === undefined ? "" : `, ${clip(obs.detail)}`})`,
      );
      return c.result(key);
    case "timeout":
      c.add("PROBE_TIMEOUT");
      return c.result(key);
    case "terms":
      break;
  }
  const n = normalizeTerms(obs.terms);
  if (!n.ok) {
    c.add("REQUIREMENTS_UNREADABLE", `(${n.reason})`);
    return c.result(key);
  }
  const t = n.terms;
  const locked = ep.observed;
  // Both sides are "x402" until MPP lands (M5); then a protocol change is reported here too.
  if (t.x402Version !== locked.x402Version) {
    c.add(
      "PROTOCOL_VERSION_CHANGED",
      change(`${locked.protocol} v${String(locked.x402Version)}`, `${t.protocol} v${String(t.x402Version)}`),
    );
  }
  if (t.resourceUrl !== locked.resourceUrl) c.add("RESOURCE_URL_MISMATCH", change(locked.resourceUrl, t.resourceUrl));
  if (integrityOf(t.envelope) !== locked.envelopeIntegrity) c.add("TERMS_CHANGED_OTHER", "(extensions changed)");

  const lockedById = new Map(Object.entries(locked.options));
  const unmatchedLive: PaymentOption[] = [];
  for (const seen of t.options) {
    const id = optionId(seen);
    const was = lockedById.get(id);
    if (was === undefined) {
      unmatchedLive.push(seen);
      continue;
    }
    lockedById.delete(id);
    compareOptions(c, was, seen, ep.policy.options[id]?.maxAmount ?? was.amount, id);
  }
  // A locked option vanished and another appeared: pair them (most shared identity fields first)
  // and report every identity field that differs. Leftovers are new or removed options.
  const unmatchedLocked = [...lockedById.values()];
  for (const seen of unmatchedLive) {
    let best = -1;
    unmatchedLocked.forEach((was, i) => {
      const bestWas = unmatchedLocked[best];
      if (bestWas === undefined || sharedIdentity(was, seen) > sharedIdentity(bestWas, seen)) best = i;
    });
    const [was] = best >= 0 ? unmatchedLocked.splice(best, 1) : [];
    if (was === undefined) {
      c.add("NEW_OPTION_OFFERED", `(${clip(optionId(seen))})`, optionId(seen));
      continue;
    }
    for (const f of IDENTITY) if (was[f] !== seen[f]) c.add(IDENTITY_CODE[f], change(was[f], seen[f]), optionId(was));
  }
  for (const was of unmatchedLocked) c.add("OPTION_REMOVED", `(${clip(optionId(was))})`, optionId(was));
  return c.result(key);
}

/**
 * Verify two (or more) identical unpaid requests (CLAUDE.md §3 item 4). Every sample is verified and
 * all findings kept (deduplicated); if the samples' normalised terms differ, that alone needs your OK.
 */
export function verifySamples(lock: Lock, key: string, samples: readonly Observation[]): EndpointResult {
  const [first, ...rest] = samples;
  if (first === undefined) throw new RangeError("verifySamples needs at least one sample");
  const results = samples.map((s) => verifyEndpoint(lock, key, s));
  const c = new Collector(lock.endpoints[key]?.policy.tighten ?? []);
  const seen = new Set<string>();
  for (const r of results) {
    for (const f of r.findings) {
      if (!seen.has(f.line)) {
        seen.add(f.line);
        c.findings.push(f);
      }
    }
    for (const n of r.notes) if (!c.notes.includes(n)) c.notes.push(n);
  }
  const fingerprint = (o: Observation): string => {
    if (o.kind !== "terms") return o.kind;
    const n = normalizeTerms(o.terms);
    return n.ok ? canonicalize(n.terms as unknown as Json) : "unreadable";
  };
  if (rest.some((s) => fingerprint(s) !== fingerprint(first)))
    c.add("TERMS_CHANGED_OTHER", "(terms differ between two identical requests)");
  return c.result(key);
}

export interface Summary {
  verdict: Verdict;
  allowed: number;
  blocked: number;
  needsOk: number;
}

export function summarize(results: readonly EndpointResult[]): Summary {
  const s: Summary = { verdict: "allowed", allowed: 0, blocked: 0, needsOk: 0 };
  for (const r of results) {
    s[r.verdict] += 1;
    if (RANK[r.verdict] > RANK[s.verdict]) s.verdict = r.verdict;
  }
  return s;
}

export type AcceptResult = { ok: true; lock: Lock } | { ok: false; reason: string };

/**
 * `paid-lock update`: replace the endpoint's observed terms with what was seen. Policy entries are
 * never changed or removed; an option without one gets the default (maxAmount = observed amount).
 * Returns a new lock; the input is not modified.
 */
export function acceptObservation(lock: Lock, key: string, seen: ObservedTerms): AcceptResult {
  const ep = lock.endpoints[key];
  if (ep === undefined) return { ok: false, reason: "endpoint is not in paid.lock (use paid-lock add)" };
  const n = normalizeTerms(seen);
  if (!n.ok) return { ok: false, reason: n.reason };
  const policyOptions = { ...ep.policy.options };
  for (const o of n.terms.options) policyOptions[optionId(o)] ??= { maxAmount: applyTolerance(o.amount, 0) };
  const next: LockedEndpoint = { observed: observedFrom(n.terms), policy: { ...ep.policy, options: policyOptions } };
  return { ok: true, lock: { ...lock, endpoints: { ...lock.endpoints, [key]: next } } };
}
