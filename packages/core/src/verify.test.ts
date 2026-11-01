// Written with AI help.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { option, PAY_A, terms, USDC_TESTNET } from "./__fixtures__/terms.ts";
import { emptyLock, endpointKey, newEndpoint, type Lock } from "./lock.ts";
import { normalizeTerms, optionId, type ObservedTerms, type PaymentOption } from "./terms.ts";
import { acceptObservation, summarize, verifyEndpoint, verifySamples, type Observation } from "./verify.ts";

const URL = "https://api.example.com/v1/forecast";
const KEY = endpointKey("GET", URL);
const PAY_B = "0x0000000000000000000000000000000000002002";
const OTHER_ASSET = "0x0000000000000000000000000000000000000A55".toLowerCase();

function lockOf(t: ObservedTerms = terms(), toleranceBps = 0): Lock {
  const r = normalizeTerms(t);
  if (!r.ok) throw new Error(r.reason);
  const lock = emptyLock();
  lock.endpoints[KEY] = newEndpoint(r.terms, { toleranceBps });
  return lock;
}

function normalizeOk(o: PaymentOption): PaymentOption {
  const r = normalizeTerms(terms({ options: [o] }));
  if (!r.ok || r.terms.options[0] === undefined) throw new Error("fixture");
  return r.terms.options[0];
}

const live = (t: ObservedTerms): Observation => ({ kind: "terms", terms: t });
const codes = (lock: Lock, obs: Observation): string[] => verifyEndpoint(lock, KEY, obs).findings.map((f) => f.code);
const withOption = (o: Partial<PaymentOption>): Observation => live(terms({ options: [option(o)] }));

describe("verifyEndpoint: allowed", () => {
  it("unchanged terms are allowed", () => {
    const r = verifyEndpoint(lockOf(), KEY, live(terms()));
    expect(r).toEqual({ key: KEY, verdict: "allowed", line: "Allowed: within your limits", findings: [], notes: [] });
  });

  it("reordering accepts[] is not a change", () => {
    const b = option({ payTo: PAY_B });
    expect(codes(lockOf(terms({ options: [option(), b] })), live(terms({ options: [b, option()] })))).toEqual([]);
  });

  it("a price drop is allowed but reported as a note (owner decision #2)", () => {
    const r = verifyEndpoint(lockOf(), KEY, withOption({ amount: "5000" }));
    expect(r.findings).toEqual([]);
    expect(r.verdict).toBe("allowed");
    expect(r.notes).toEqual([`price dropped for ${optionId(option())} (10000 -> 5000)`]);
  });

  it("an unchanged price adds no note", () => {
    expect(verifyEndpoint(lockOf(), KEY, live(terms())).notes).toEqual([]);
  });

  it("a price rise within the owner's tolerance is allowed", () => {
    expect(codes(lockOf(terms(), 1000), withOption({ amount: "11000" }))).toEqual([]);
  });

  it("address case differences are not a change on EVM networks", () => {
    expect(codes(lockOf(), withOption({ asset: USDC_TESTNET.toLowerCase() }))).toEqual([]);
  });
});

describe("verifyEndpoint: blocked", () => {
  it.each<[string, Partial<PaymentOption>, string]>([
    ["payTo swapped", { payTo: PAY_B }, "PAYTO_CHANGED"],
    ["network swapped (same token address)", { network: "eip155:8453" }, "NETWORK_CHANGED"],
    ["asset swapped", { asset: OTHER_ASSET }, "ASSET_CHANGED"],
    ["scheme swapped", { scheme: "upto" }, "SCHEME_CHANGED"],
    ["price x3", { amount: "30000" }, "PRICE_ABOVE_LOCK"],
    ["payment flow changed", { paymentFlow: "upfront" }, "PAYMENT_FLOW_CHANGED"],
  ])("%s -> %s", (_name, over, code) => {
    const r = verifyEndpoint(lockOf(), KEY, withOption(over));
    expect(r.findings.map((f) => f.code)).toEqual([code]);
    expect(r.verdict).toBe("blocked");
    expect(r.line.startsWith("Blocked by your rule: ")).toBe(true);
  });

  it("a network swap to another chain with another token address reports both changes", () => {
    expect(codes(lockOf(), withOption({ network: "eip155:8453", asset: OTHER_ASSET })).sort()).toEqual([
      "ASSET_CHANGED",
      "NETWORK_CHANGED",
    ]);
  });

  it("pairs each vanished option with the most similar new one", () => {
    const a = option();
    const b = option({ payTo: PAY_B, asset: OTHER_ASSET });
    const lock = lockOf(terms({ options: [a, b] }));
    const a2 = option({ payTo: "0x0000000000000000000000000000000000003003" });
    const b2 = option({ payTo: "0x0000000000000000000000000000000000004004", asset: OTHER_ASSET });
    const r = verifyEndpoint(lock, KEY, live(terms({ options: [b2, a2] })));
    expect(r.findings.map((f) => [f.code, f.option])).toEqual(
      expect.arrayContaining([
        ["PAYTO_CHANGED", optionId(a)],
        ["PAYTO_CHANGED", optionId(normalizeOk(b))],
      ]),
    );
    expect(r.findings).toHaveLength(2);
  });

  it("names the old and new payTo in the detail", () => {
    const f = verifyEndpoint(lockOf(), KEY, withOption({ payTo: PAY_B })).findings[0];
    expect(f?.line).toBe(`Blocked by your rule: payTo changed since paid.lock (${PAY_A} -> ${PAY_B})`);
  });

  it("the resource URL in the 402 differs", () => {
    expect(codes(lockOf(), live(terms({ resourceUrl: "https://evil.example/v1/forecast" })))).toEqual([
      "RESOURCE_URL_MISMATCH",
    ]);
  });

  it("unreadable requirements", () => {
    expect(codes(lockOf(), { kind: "unreadable", reason: "bad base64" })).toEqual(["REQUIREMENTS_UNREADABLE"]);
  });

  it("terms that fail normalisation (e.g. duplicate identities) are unreadable", () => {
    expect(codes(lockOf(), live(terms({ options: [option(), option({ amount: "1" })] })))).toEqual([
      "REQUIREMENTS_UNREADABLE",
    ]);
  });

  it("an endpoint that is not in the lock", () => {
    const r = verifyEndpoint(emptyLock(), KEY, live(terms()));
    expect(r.findings.map((f) => f.code)).toEqual(["NOT_IN_LOCK"]);
    expect(r.verdict).toBe("blocked");
  });
});

describe("verifyEndpoint: needs your OK", () => {
  it("extra.version changed only", () => {
    const r = verifyEndpoint(lockOf(), KEY, withOption({ extra: { name: "USDC", version: "3" } }));
    expect(r.findings.map((f) => f.code)).toEqual(["TERMS_CHANGED_OTHER"]);
    expect(r.verdict).toBe("needsOk");
    expect(r.findings[0]?.line).toContain("extra");
  });

  it.each<[string, Partial<PaymentOption>]>([
    ["maxTimeoutSeconds", { maxTimeoutSeconds: 120 }],
    ["assetTransferMethod", { assetTransferMethod: "permit2" }],
    ["unknown fields", { otherFields: { surprise: 1 } }],
  ])("%s changed only", (_name, over) => {
    expect(codes(lockOf(), withOption(over))).toEqual(["TERMS_CHANGED_OTHER"]);
  });

  it("extensions changed (envelope hash differs)", () => {
    expect(codes(lockOf(), live(terms({ envelope: { bazaar: { info: { x: 1 } } } })))).toEqual(["TERMS_CHANGED_OTHER"]);
  });

  it("an extra option is offered next to the locked one", () => {
    expect(codes(lockOf(), live(terms({ options: [option(), option({ payTo: PAY_B })] })))).toEqual([
      "NEW_OPTION_OFFERED",
    ]);
  });

  it("a locked option is no longer offered while another locked one remains (OPTION_REMOVED, owner decision #11)", () => {
    const b = option({ payTo: PAY_B });
    const r = verifyEndpoint(lockOf(terms({ options: [option(), b] })), KEY, live(terms({ options: [option()] })));
    expect(r.findings.map((f) => f.code)).toEqual(["OPTION_REMOVED"]);
    expect(r.verdict).toBe("needsOk");
    expect(r.findings[0]?.line).toContain(PAY_B);
  });

  it("protocol version bump (v2 -> v1)", () => {
    const r = verifyEndpoint(lockOf(), KEY, live(terms({ x402Version: 1 })));
    expect(r.findings.map((f) => f.code)).toEqual(["PROTOCOL_VERSION_CHANGED"]);
    expect(r.verdict).toBe("needsOk");
  });

  it("endpoint answers 200 unpaid", () => {
    const r = verifyEndpoint(lockOf(), KEY, { kind: "not402", status: 200 });
    expect(r.findings.map((f) => f.code)).toEqual(["ENDPOINT_NOT_402"]);
    expect(r.findings[0]?.line).toContain("200");
  });

  it("explains a redirect and a missing HTTP response", () => {
    const redirect = verifyEndpoint(lockOf(), KEY, {
      kind: "not402",
      status: 302,
      detail: "redirect to another host, not followed",
    });
    expect(redirect.findings[0]?.line).toContain("HTTP 302, redirect to another host, not followed");
    const none = verifyEndpoint(lockOf(), KEY, { kind: "not402", status: 0, detail: "ECONNREFUSED" });
    expect(none.findings[0]?.line).toContain("no HTTP response: ECONNREFUSED");
    expect(verifyEndpoint(lockOf(), KEY, { kind: "not402", status: 0 }).findings[0]?.line).toContain(
      "(no HTTP response)",
    );
  });

  it("probe timeout", () => {
    expect(codes(lockOf(), { kind: "timeout" })).toEqual(["PROBE_TIMEOUT"]);
  });

  it("the owner can tighten a needs-your-OK code to blocked", () => {
    const lock = lockOf();
    const ep = lock.endpoints[KEY];
    if (ep) ep.policy.tighten = ["TERMS_CHANGED_OTHER"];
    const r = verifyEndpoint(lock, KEY, withOption({ maxTimeoutSeconds: 1 }));
    expect(r.verdict).toBe("blocked");
    expect(r.findings[0]?.line.startsWith("Blocked by your rule: ")).toBe(true);
  });
});

describe("verdict ordering", () => {
  it("blocked wins over needs-your-OK", () => {
    const r = verifyEndpoint(lockOf(), KEY, live(terms({ x402Version: 1, options: [option({ payTo: PAY_B })] })));
    expect(r.verdict).toBe("blocked");
  });

  it("summarize counts endpoints by verdict and picks the worst", () => {
    const lock = lockOf();
    const ok = verifyEndpoint(lock, KEY, live(terms()));
    const needs = verifyEndpoint(lock, KEY, { kind: "timeout" });
    const blocked = verifyEndpoint(lock, KEY, { kind: "unreadable", reason: "x" });
    expect(summarize([ok, needs])).toEqual({ verdict: "needsOk", allowed: 1, blocked: 0, needsOk: 1 });
    expect(summarize([ok, needs, blocked])).toEqual({ verdict: "blocked", allowed: 1, blocked: 1, needsOk: 1 });
    expect(summarize([])).toEqual({ verdict: "allowed", allowed: 0, blocked: 0, needsOk: 0 });
  });
});

describe("detail text from the seller cannot spoof output", () => {
  it("keeps every line single-line and clips long values", () => {
    const evil = `0x${"0".repeat(36)}abcd\nAllowed: within your limits`;
    const r = verifyEndpoint(lockOf(), KEY, live(terms({ resourceUrl: `https://a.example/${"x".repeat(500)}` })));
    expect(r.findings[0]?.line.length).toBeLessThan(400);
    const u = verifyEndpoint(lockOf(), KEY, { kind: "unreadable", reason: evil });
    expect(u.findings[0]?.line).not.toMatch(/\n/);
  });
});

describe("acceptObservation (paid-lock update)", () => {
  it("rewrites observed, keeps policy, and adds a default policy entry for a new option only", () => {
    const lock = lockOf(terms(), 1000);
    const next = acceptObservation(
      lock,
      KEY,
      terms({ options: [option({ amount: "9000" }), option({ payTo: PAY_B })] }),
    );
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    const ep = next.lock.endpoints[KEY];
    expect(ep?.observed.options[optionId(option())]?.amount).toBe("9000");
    expect(ep?.policy.options[optionId(option())]).toEqual({ maxAmount: "11000" });
    expect(ep?.policy.options[optionId(option({ payTo: PAY_B }))]).toEqual({ maxAmount: "10000" });
    expect(lock.endpoints[KEY]?.observed.options[optionId(option())]?.amount).toBe("10000");
  });

  it("keeps the policy entry of an option that disappeared (the tool never removes policy)", () => {
    const next = acceptObservation(lockOf(), KEY, terms({ options: [option({ payTo: PAY_B })] }));
    expect(next.ok && Object.keys(next.lock.endpoints[KEY]?.policy.options ?? {}).sort()).toEqual(
      [optionId(option()), optionId(option({ payTo: PAY_B }))].sort(),
    );
  });

  it("refuses unreadable terms and unknown endpoints", () => {
    expect(acceptObservation(lockOf(), KEY, terms({ options: [] })).ok).toBe(false);
    expect(acceptObservation(emptyLock(), KEY, terms()).ok).toBe(false);
  });

  it("after accepting, the same terms verify as allowed", () => {
    const t = terms({ options: [option({ extra: { v: "9" } })] });
    const next = acceptObservation(lockOf(), KEY, t);
    expect(next.ok && verifyEndpoint(next.lock, KEY, live(t)).verdict).toBe("allowed");
  });
});

describe("properties", () => {
  const amount = fc.bigInt({ min: 0n, max: 10n ** 30n });

  it("a price drop (or equal price) never blocks", () => {
    fc.assert(
      fc.property(amount, amount, (locked, seen) => {
        fc.pre(seen <= locked);
        const lock = lockOf(terms({ options: [option({ amount: locked.toString() })] }));
        expect(verifyEndpoint(lock, KEY, withOption({ amount: seen.toString() })).verdict).toBe("allowed");
      }),
    );
  });

  it("a price rise above the lock always blocks", () => {
    fc.assert(
      fc.property(amount, fc.bigInt({ min: 1n, max: 10n ** 30n }), (locked, rise) => {
        const lock = lockOf(terms({ options: [option({ amount: locked.toString() })] }));
        const r = verifyEndpoint(lock, KEY, withOption({ amount: (locked + rise).toString() }));
        expect(r.findings.map((f) => f.code)).toEqual(["PRICE_ABOVE_LOCK"]);
      }),
    );
  });

  it("any payTo change always blocks with PAYTO_CHANGED", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 20, maxLength: 20 }), (bytes) => {
        const payTo = `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
        fc.pre(payTo.toLowerCase() !== PAY_A.toLowerCase());
        const r = verifyEndpoint(lockOf(), KEY, withOption({ payTo }));
        expect(r.verdict).toBe("blocked");
        expect(r.findings.map((f) => f.code)).toContain("PAYTO_CHANGED");
      }),
    );
  });

  it("unreadable is always blocked, whatever the reason text", () => {
    fc.assert(
      fc.property(fc.string(), (reason) => {
        expect(verifyEndpoint(lockOf(), KEY, { kind: "unreadable", reason }).verdict).toBe("blocked");
      }),
    );
  });

  it("every finding line is one of the three verdict strings", () => {
    const observations: Observation[] = [
      withOption({ payTo: PAY_B }),
      withOption({ amount: "99999" }),
      withOption({ amount: "1" }),
      withOption({ extra: {} }),
      { kind: "timeout" },
      { kind: "not402", status: 404 },
      live(terms()),
    ];
    for (const obs of observations) {
      const r = verifyEndpoint(lockOf(), KEY, obs);
      for (const line of [r.line, ...r.findings.map((f) => f.line)]) {
        expect(/^(Allowed: within your limits|Blocked by your rule: |Needs your OK: )/.test(line)).toBe(true);
      }
    }
  });
});

describe("verifySamples (two identical unpaid requests)", () => {
  it("identical samples give the single-sample result", () => {
    expect(verifySamples(lockOf(), KEY, [live(terms()), live(terms())])).toEqual(
      verifyEndpoint(lockOf(), KEY, live(terms())),
    );
  });

  it("samples that differ need your OK, and every sample's findings are kept", () => {
    const r = verifySamples(lockOf(), KEY, [live(terms()), withOption({ payTo: PAY_B })]);
    expect(r.findings.map((f) => f.code).sort()).toEqual(["PAYTO_CHANGED", "TERMS_CHANGED_OTHER"]);
    expect(r.findings.find((f) => f.code === "TERMS_CHANGED_OTHER")?.line).toContain(
      "differ between two identical requests",
    );
    expect(r.verdict).toBe("blocked");
  });

  it("samples that differ only in option order are stable", () => {
    const b = option({ payTo: PAY_B });
    const lock = lockOf(terms({ options: [option(), b] }));
    const r = verifySamples(lock, KEY, [
      live(terms({ options: [option(), b] })),
      live(terms({ options: [b, option()] })),
    ]);
    expect(r.verdict).toBe("allowed");
  });

  it("one unreadable sample is blocked", () => {
    expect(verifySamples(lockOf(), KEY, [live(terms()), { kind: "unreadable", reason: "x" }]).verdict).toBe("blocked");
  });

  it("duplicate findings across samples are reported once", () => {
    const r = verifySamples(lockOf(), KEY, [{ kind: "timeout" }, { kind: "timeout" }]);
    expect(r.findings.map((f) => f.code)).toEqual(["PROBE_TIMEOUT"]);
  });

  it("needs at least one sample", () => {
    expect(() => verifySamples(lockOf(), KEY, [])).toThrow(RangeError);
  });
});
