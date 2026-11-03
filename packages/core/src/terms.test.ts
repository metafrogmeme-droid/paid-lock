import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mppTerms, option, PAY_A, terms, USDC_TESTNET } from "./__fixtures__/terms.ts";
import { normalizeTerms, optionId, optionIntegrity, type ObservedTerms, type PaymentOption } from "./terms.ts";

describe("optionId", () => {
  it("is scheme, network, asset and payTo joined by spaces", () => {
    expect(optionId(option())).toBe(`exact eip155:84532 ${USDC_TESTNET} ${PAY_A}`);
  });
});

describe("optionIntegrity", () => {
  it("ignores the amount (price is checked against policy, so a price drop never changes the hash)", () => {
    expect(optionIntegrity(option({ amount: "5000" }))).toBe(optionIntegrity(option()));
  });

  it.each<[string, Partial<PaymentOption>]>([
    ["extra.version", { extra: { name: "USDC", version: "3" } }],
    ["maxTimeoutSeconds", { maxTimeoutSeconds: 61 }],
    ["assetTransferMethod", { assetTransferMethod: "permit2" }],
    ["paymentFlow", { paymentFlow: "upfront" }],
    ["unknown fields", { otherFields: { surprise: true } }],
    ["payTo", { payTo: "0x0000000000000000000000000000000000002002" }],
  ])("changes when %s changes", (_name, over) => {
    expect(optionIntegrity(option(over))).not.toBe(optionIntegrity(option()));
  });

  it("property: ignores key order inside extra", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.string()), (extra) => {
        const reversed = Object.fromEntries(Object.entries(extra).reverse());
        expect(optionIntegrity(option({ extra: reversed }))).toBe(optionIntegrity(option({ extra })));
      }),
    );
  });
});

describe("normalizeTerms", () => {
  it("checksums EVM addresses and sorts options by identity", () => {
    const b = option({ payTo: "0x0000000000000000000000000000000000002002" });
    const r = normalizeTerms(terms({ options: [b, option({ asset: USDC_TESTNET.toLowerCase() })] }));
    expect(r.ok && r.terms.options.map((o) => o.payTo)).toEqual([PAY_A, b.payTo]);
    expect(r.ok && r.terms.options[0]?.asset).toBe(USDC_TESTNET);
  });

  it("property: the result does not depend on the order of accepts[]", () => {
    const opts = [0, 1, 2, 3].map((i) => option({ payTo: `0x${String(i + 1).padStart(40, "0")}` }));
    fc.assert(
      fc.property(fc.shuffledSubarray(opts, { minLength: 4, maxLength: 4 }), (shuffled) => {
        expect(normalizeTerms(terms({ options: shuffled }))).toEqual(normalizeTerms(terms({ options: opts })));
      }),
    );
  });

  it.each<[string, Partial<ObservedTerms>]>([
    ["no options", { options: [] }],
    ["two options with the same identity", { options: [option(), option({ amount: "1" })] }],
    ["a bad amount", { options: [option({ amount: "1.5" })] }],
    ["a negative timeout", { options: [option({ maxTimeoutSeconds: -1 })] }],
    ["a bad EIP-55 checksum", { options: [option({ payTo: "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" })] }],
    ["a network that is not CAIP-2", { options: [option({ network: "base-sepolia" })] }],
    ["a scheme with a space", { options: [option({ scheme: "ex act" })] }],
    ["an empty payment flow", { options: [option({ paymentFlow: "" })] }],
    ["an unknown payment flow", { options: [option({ paymentFlow: "later" })] }],
    ["a resource URL that is not absolute", { resourceUrl: "/v1/forecast" }],
  ])("refuses %s (fail closed)", (_name, over) => {
    const r = normalizeTerms(terms(over));
    expect(r.ok).toBe(false);
  });

  it("accepts every payment flow defined by x402 v2 §6.1", () => {
    for (const paymentFlow of ["authorization", "upfront", "escrow"]) {
      expect(normalizeTerms(terms({ options: [option({ paymentFlow })] })).ok).toBe(true);
    }
  });

  it("normalises the resource URL", () => {
    const r = normalizeTerms(terms({ resourceUrl: "HTTPS://Shop.Example.com:443/v1/forecast" }));
    expect(r.ok && r.terms.resourceUrl).toBe("https://shop.example.com/v1/forecast");
  });
});

describe("normalizeTerms: protocol and version (MPP, D-027)", () => {
  it("accepts MPP terms, which have no x402Version", () => {
    const r = normalizeTerms(mppTerms());
    expect(r.ok).toBe(true);
  });

  it("refuses MPP terms that carry an x402Version, and x402 terms without one", () => {
    expect(normalizeTerms({ ...mppTerms(), x402Version: 2 })).toEqual({
      ok: false,
      reason: "x402Version is only valid for x402",
    });
    const noVersion = terms();
    delete noVersion.x402Version;
    expect(normalizeTerms(noVersion)).toEqual({ ok: false, reason: "x402Version must be a positive integer" });
    expect(normalizeTerms(terms({ x402Version: 0 })).ok).toBe(false);
    expect(normalizeTerms(terms({ x402Version: 1.5 })).ok).toBe(false);
  });
});
