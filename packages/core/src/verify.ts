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
  /** Set on the finding that reports two identical requests seeing different terms. */
  tag?: "unstable-samples";
  /**
   * The locked and the new value, when the finding compares one value (identity fields, payment flow,
   * protocol, resource URL; for PRICE_ABOVE_LOCK `locked` is the locked maximum). Seller text is clipped
   * as in `line`. For an owner-OK queue entry (docs/CLAW_PAY.md).
   */
  change?: ValueChange;
}

export interface ValueChange {
  locked: string;
  new: string;
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

function pair(locked: string, now: string): ValueChange {
  return { locked: clip(locked), new: clip(now) };
}

class Collector {
  readonly findings: Finding[] = [];
  readonly notes: string[] = [];
  private readonly tighten: readonly string[];
  constructor(tighten: readonly string[]) {
    this.tighten = tighten;
  }

  add(code: ReasonCode, extra?: string, option?: string, tag?: Finding["tag"], values?: ValueChange): void {
    const base = REASONS[code];
    const verdict: Verdict = base.verdict === "needsOk" && this.tighten.includes(code) ? "blocked" : base.verdict;
    const detail = extra === undefined ? base.detail : `${base.detail} ${extra}`;
    const finding: Finding = { code, verdict, line: verdictLine(verdict, detail) };
    if (option !== undefined) finding.option = option;
    if (tag !== undefined) finding.tag = tag;
    if (values !== undefined) finding.change = values;
    this.findings.push(finding);
  }

  /** A finding about one value that changed: the line shows `(locked -> new)`, `change` holds both. */
  changed(code: ReasonCode, locked: string, now: string, option?: string): void {
    this.add(code, change(locked, now), option, undefined, pair(locked, now));
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

function protocolLabel(t: Pick<ObservedTerms, "protocol" | "x402Version">): string {
  return t.protocol === "mpp" ? "mpp" : `x402 v${String(t.x402Version)}`;
}

function sharedIdentity(a: PaymentOption, b: PaymentOption): number {
  return IDENTITY.filter((f) => a[f] === b[f]).length;
}

function compareOptions(c: Collector, locked: PaymentOption, seen: PaymentOption, maxAmount: string, id: string): void {
  if (BigInt(seen.amount) > BigInt(maxAmount))
    c.add("PRICE_ABOVE_LOCK", `(${clip(seen.amount)} > ${maxAmount})`, id, undefined, pair(maxAmount, seen.amount));
  else if (BigInt(seen.amount) < BigInt(locked.amount))
    c.notes.push(`price dropped for ${id} ${change(locked.amount, seen.amount)}`);
  if (seen.paymentFlow !== locked.paymentFlow)
    c.changed("PAYMENT_FLOW_CHANGED", locked.paymentFlow, seen.paymentFlow, id);
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
  const t = readableTerms(c, obs);
  if (t === undefined) return c.result(key);
  const locked = ep.observed;
  // A switch between x402 versions, or between x402 and MPP, needs your OK (approved P-01, D-027).
  if (protocolLabel(t) !== protocolLabel(locked)) {
    c.changed("PROTOCOL_VERSION_CHANGED", protocolLabel(locked), protocolLabel(t));
  }
  if (t.resourceUrl !== locked.resourceUrl) c.changed("RESOURCE_URL_MISMATCH", locked.resourceUrl, t.resourceUrl);
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
    for (const f of IDENTITY) if (was[f] !== seen[f]) c.changed(IDENTITY_CODE[f], was[f], seen[f], optionId(was));
  }
  for (const was of unmatchedLocked) c.add("OPTION_REMOVED", `(${clip(optionId(was))})`, optionId(was));
  return c.result(key);
}

/**
 * Verify two (or more) identical unpaid requests (CLAUDE.md §3 item 4). Every sample is verified and
 * all findings kept (deduplicated); if the samples' normalised terms differ, that alone needs your OK.
 */
export function verifySamples(lock: Lock, key: string, samples: readonly Observation[]): EndpointResult {
  if (samples.length === 0) throw new RangeError("verifySamples needs at least one sample");
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
  if (samplesDiffer(samples)) {
    c.add("TERMS_CHANGED_OTHER", "(terms differ between two identical requests)", undefined, "unstable-samples");
  }
  return c.result(key);
}

/** Result for an endpoint that is not in paid.lock: Blocked, without probing it at all. */
export function notInLock(key: string): EndpointResult {
  const c = new Collector([]);
  c.add("NOT_IN_LOCK");
  return c.result(key);
}

/** Normalised terms, or undefined after adding the finding that explains why there are none. */
function readableTerms(c: Collector, obs: Observation): ObservedTerms | undefined {
  switch (obs.kind) {
    case "unreadable":
      c.add("REQUIREMENTS_UNREADABLE", `(${clip(obs.reason)})`);
      return undefined;
    case "not402":
      c.add(
        "ENDPOINT_NOT_402",
        obs.status === 0
          ? `(no HTTP response${obs.detail === undefined ? "" : `: ${clip(obs.detail)}`})`
          : `(HTTP ${String(obs.status)}${obs.detail === undefined ? "" : `, ${clip(obs.detail)}`})`,
      );
      return undefined;
    case "timeout":
      c.add("PROBE_TIMEOUT");
      return undefined;
    case "terms": {
      const n = normalizeTerms(obs.terms);
      if (n.ok) return n.terms;
      c.add("REQUIREMENTS_UNREADABLE", `(${n.reason})`);
      return undefined;
    }
  }
}

function samplesDiffer(samples: readonly Observation[]): boolean {
  const fingerprint = (o: Observation): string => {
    if (o.kind !== "terms") return o.kind;
    const n = normalizeTerms(o.terms);
    return n.ok ? canonicalize(n.terms as unknown as Json) : "unreadable";
  };
  const [first, ...rest] = samples.map(fingerprint);
  return rest.some((f) => f !== first);
}

/**
 * What `paid-lock add` checks before pinning a new endpoint: every sample must be readable terms and
 * all samples must agree. Allowed means the first sample can be pinned.
 */
export function verifyUnpinned(key: string, samples: readonly Observation[]): EndpointResult {
  if (samples.length === 0) throw new RangeError("verifyUnpinned needs at least one sample");
  const c = new Collector([]);
  const seen = new Set<string>();
  // The 402 must name the URL that was requested: pinning terms under another URL's entry is how a
  // confused-deputy entry would get into a lock (THREAT_MODEL T23, audit L6).
  const requested = key.slice(key.indexOf(" ") + 1);
  for (const s of samples) {
    const probeOnly = new Collector([]);
    const t = readableTerms(probeOnly, s);
    if (t !== undefined && t.resourceUrl !== requested) {
      probeOnly.changed("RESOURCE_URL_MISMATCH", requested, t.resourceUrl);
    }
    for (const f of probeOnly.findings) {
      if (!seen.has(f.line)) {
        seen.add(f.line);
        c.findings.push(f);
      }
    }
  }
  if (samplesDiffer(samples)) {
    c.add("TERMS_CHANGED_OTHER", "(terms differ between two identical requests)", undefined, "unstable-samples");
  }
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
