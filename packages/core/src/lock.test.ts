// Written with AI help.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { option, terms, USDC_TESTNET } from "./__fixtures__/terms.ts";
import {
  emptyLock,
  endpointKey,
  newEndpoint,
  parseLock,
  serializeLock,
  type Lock,
  type LockedEndpoint,
} from "./lock.ts";
import { normalizeTerms, optionId, type ObservedTerms } from "./terms.ts";

function normalized(t: ObservedTerms = terms()): ObservedTerms {
  const r = normalizeTerms(t);
  if (!r.ok) throw new Error(r.reason);
  return r.terms;
}

function lockWith(t: ObservedTerms = terms(), toleranceBps = 0): Lock {
  const lock = emptyLock();
  lock.endpoints[endpointKey("GET", t.resourceUrl)] = newEndpoint(normalized(t), { toleranceBps });
  return lock;
}

describe("endpointKey", () => {
  it("is the method and the normalised URL", () => {
    expect(endpointKey("GET", "HTTPS://Shop.Example.com:443/v1/forecast")).toBe(
      "GET https://shop.example.com/v1/forecast",
    );
    expect(endpointKey("POST", "https://a.example/x?q=1")).toBe("POST https://a.example/x?q=1");
    expect(endpointKey("GET", "https://a.example")).toBe("GET https://a.example");
  });

  it("throws on a URL that cannot be normalised", () => {
    expect(() => endpointKey("GET", "https://a.example/a b")).toThrow(/whitespace/);
  });
});

describe("newEndpoint", () => {
  it("splits observed terms from the owner's policy; maxAmount defaults to the observed amount", () => {
    const ep = newEndpoint(normalized(), { toleranceBps: 0 });
    const id = optionId(option());
    expect(ep.observed.options[id]?.amount).toBe("10000");
    expect(ep.policy.options[id]).toEqual({ maxAmount: "10000" });
    expect(ep.observed.x402Version).toBe(2);
    expect(ep.observed.envelopeIntegrity).toMatch(/^sha256-/);
  });

  it("records the private-network opt-in only when asked", () => {
    expect(newEndpoint(normalized(), { toleranceBps: 0 }).policy.allowPrivateNetwork).toBeUndefined();
    expect(newEndpoint(normalized(), { toleranceBps: 0, allowPrivateNetwork: true }).policy.allowPrivateNetwork).toBe(
      true,
    );
  });

  it("applies a tolerance to the policy only", () => {
    const ep = newEndpoint(normalized(), { toleranceBps: 1000 });
    const id = optionId(option());
    expect(ep.policy.options[id]?.maxAmount).toBe("11000");
    expect(ep.observed.options[id]?.amount).toBe("10000");
  });
});

describe("serializeLock / parseLock", () => {
  it("writes sorted keys, two-space indent and one trailing newline, without timestamps or tool versions", () => {
    const text = serializeLock(lockWith());
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.startsWith('{\n  "endpoints": {')).toBe(true);
    expect(text).not.toMatch(/lockedAt|generatedBy/);
  });

  it("round-trips byte for byte", () => {
    const text = serializeLock(lockWith());
    const parsed = parseLock(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && serializeLock(parsed.lock)).toBe(text);
  });

  it("is deterministic: the same terms in any accepts[] order give the same bytes", () => {
    const b = option({ payTo: "0x0000000000000000000000000000000000002002" });
    expect(serializeLock(lockWith(terms({ options: [option(), b] })))).toBe(
      serializeLock(lockWith(terms({ options: [b, option()] }))),
    );
  });

  it("accepts an empty lock", () => {
    expect(parseLock('{"endpoints":{},"lockfileVersion":1}').ok).toBe(true);
  });

  type Opt = LockedEndpoint["observed"]["options"][string];
  function mutate(f: (lock: Lock, ep: LockedEndpoint, opt: Opt) => void): string {
    const lock = structuredClone(lockWith());
    const ep = Object.values(lock.endpoints)[0];
    const opt = ep === undefined ? undefined : Object.values(ep.observed.options)[0];
    if (ep === undefined || opt === undefined) throw new Error("fixture has no option");
    f(lock, ep, opt);
    return JSON.stringify(lock);
  }

  it.each<[string, (lock: Lock, ep: LockedEndpoint, opt: Opt) => void]>([
    ["another lockfileVersion", (l) => Object.assign(l, { lockfileVersion: 2 })],
    [
      "an unknown top-level key (lockedAt was dropped by P-01)",
      (l) => Object.assign(l, { lockedAt: "2026-11-02T10:00:00Z" }),
    ],
    ["a tampered payTo (integrity mismatch)", (_l, _e, o) => (o.payTo = "0x0000000000000000000000000000000000002002")],
    ["a tampered integrity", (_l, _e, o) => (o.integrity = `sha256-${"A".repeat(43)}=`)],
    ["a lowercase (not checksummed) asset", (_l, _e, o) => (o.asset = USDC_TESTNET.toLowerCase())],
    ["an observed option without a policy entry", (_l, e) => (e.policy = { options: {} })],
    [
      "a bad maxAmount",
      (_l, e) => {
        Object.values(e.policy.options).forEach((p) => (p.maxAmount = "1e5"));
      },
    ],
    ["tightening a blocked code", (_l, e) => (e.policy.tighten = ["PAYTO_CHANGED"])],
    ["tightening a code twice", (_l, e) => (e.policy.tighten = ["PROBE_TIMEOUT", "PROBE_TIMEOUT"])],
    ["a non-normalised endpoint URL", (l, e) => (l.endpoints = { "GET HTTPS://Shop.Example.com/v1/forecast": e })],
    ["a non-normalised resource URL", (_l, e) => (e.observed.resourceUrl = "https://shop.example.com:443/v1/forecast")],
    ["an endpoint key with another method", (l, e) => (l.endpoints = { "PUT https://api.example.com/v1/forecast": e })],
  ])("rejects %s", (_name, f) => {
    const r = parseLock(mutate(f));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.length).toBeGreaterThan(0);
  });

  it("accepts the private-network opt-in as true only", () => {
    expect(parseLock(mutate((_l, e) => (e.policy.allowPrivateNetwork = true))).ok).toBe(true);
    expect(parseLock(mutate((_l, e) => Object.assign(e.policy, { allowPrivateNetwork: false }))).ok).toBe(false);
  });

  it("accepts a valid tighten list", () => {
    expect(parseLock(mutate((_l, e) => (e.policy.tighten = ["TERMS_CHANGED_OTHER"]))).ok).toBe(true);
  });

  it("rejects a lock nested deeper than 64 levels without exhausting the stack", () => {
    const deep = `{"lockfileVersion":1,"endpoints":${"[".repeat(5000)}${"]".repeat(5000)}}`;
    const r = parseLock(deep);
    expect(!r.ok && r.errors).toEqual(["paid.lock is nested too deeply"]);
  });

  it("rejects text that is not JSON or is too large", () => {
    expect(parseLock("{").ok).toBe(false);
    expect(parseLock(" ".repeat(8 * 1024 * 1024 + 1)).ok).toBe(false);
  });

  it("property: any accepts[] order and any tolerance round-trips byte for byte", () => {
    const opts = [1, 2, 3].map((i) => option({ payTo: `0x${String(i).padStart(40, "0")}`, amount: String(i * 1000) }));
    fc.assert(
      fc.property(fc.shuffledSubarray(opts, { minLength: 1 }), fc.integer({ min: 0, max: 10_000 }), (subset, bps) => {
        const text = serializeLock(lockWith(terms({ options: subset }), bps));
        const parsed = parseLock(text);
        expect(parsed.ok && serializeLock(parsed.lock)).toBe(text);
      }),
    );
  });
});
