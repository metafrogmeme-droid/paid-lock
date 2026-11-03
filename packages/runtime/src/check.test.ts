import {
  decode,
  emptyLock,
  endpointKey,
  newEndpoint,
  normalizeTerms,
  REASON_CODES,
  VERDICTS,
  type Lock,
  type ReasonCode,
} from "@paid-lock/core";
import { parsePaymentRequired } from "@paid-lock/protocols";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allows, checkAgainstLock, checkResponse, checkSelected } from "./check.ts";

// Test fixture: fake payTo addresses; the asset is Base Sepolia (testnet) USDC from the x402 v2 spec.
const URL_ = "https://shop.example.com/v1/forecast";
const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PAY = "0x0000000000000000000000000000000000001001";
const OTHER_PAY = "0x000000000000000000000000000000000000dEaD";

const pr = (req: Record<string, unknown> = {}, top: Record<string, unknown> = {}): Record<string, unknown> => ({
  x402Version: 2,
  resource: { url: URL_ },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      amount: "10000",
      asset: ASSET,
      payTo: PAY,
      maxTimeoutSeconds: 60,
      extra: { name: "USDC", version: "2" },
      ...req,
    },
  ],
  ...top,
});

function lockFor(tighten: ReasonCode[] = []): Lock {
  const parsed = parsePaymentRequired(pr());
  if (!parsed.ok) throw new Error(parsed.reason);
  const ep = newEndpoint(parsed.terms, { toleranceBps: 0 });
  const lock = emptyLock();
  lock.endpoints[endpointKey("GET", URL_)] = { ...ep, policy: { ...ep.policy, tighten } };
  return lock;
}
const header = (obj: unknown): string => Buffer.from(JSON.stringify(obj), "utf8").toString("base64");

describe("checkAgainstLock", () => {
  it("allows the terms that were pinned", () => {
    expect(checkAgainstLock(lockFor(), "GET", URL_, pr())).toEqual({
      verdict: "allowed",
      code: "OK",
      detail: "Allowed: within your limits",
      findings: [],
      notes: [],
    });
  });

  it("blocks a changed payTo, with the exact wording a client hook can show", () => {
    const r = checkAgainstLock(lockFor(), "GET", URL_, pr({ payTo: OTHER_PAY }));
    expect(r.verdict).toBe("blocked");
    expect(r.code).toBe("PAYTO_CHANGED");
    expect(r.detail.startsWith("Blocked by your rule: payTo changed since paid.lock")).toBe(true);
  });

  it("gives the locked and new value of the reason, for an owner-OK queue entry", () => {
    expect(checkAgainstLock(lockFor(), "GET", URL_, pr({ payTo: OTHER_PAY })).change).toEqual({
      locked: PAY,
      new: OTHER_PAY,
    });
    const price = checkAgainstLock(lockFor(), "GET", URL_, pr({ amount: "10001" }));
    expect([price.code, price.change]).toEqual(["PRICE_ABOVE_LOCK", { locked: "10000", new: "10001" }]);
    const ok = checkAgainstLock(lockFor(), "GET", URL_, pr());
    const other = checkAgainstLock(lockFor(), "GET", URL_, pr({ maxTimeoutSeconds: 30 }));
    expect([ok, other].map((r) => [r.code, "change" in r])).toEqual([
      ["OK", false],
      ["TERMS_CHANGED_OTHER", false],
    ]);
  });

  it.each([
    ["network", { network: "eip155:8453" }, "NETWORK_CHANGED"],
    ["asset", { asset: "0x0000000000000000000000000000000000000bad" }, "ASSET_CHANGED"],
    ["scheme", { scheme: "upto" }, "SCHEME_CHANGED"],
    ["price above the lock", { amount: "10001" }, "PRICE_ABOVE_LOCK"],
    ["payment flow", { extra: { name: "USDC", version: "2", paymentFlow: "escrow" } }, "PAYMENT_FLOW_CHANGED"],
  ])("blocks a changed %s", (_name, req, code) => {
    const r = checkAgainstLock(lockFor(), "GET", URL_, pr(req));
    expect([r.verdict, r.code]).toEqual(["blocked", code]);
  });

  it("blocks a 402 that names another resource URL", () => {
    const r = checkAgainstLock(lockFor(), "GET", URL_, pr({}, { resource: { url: `${URL_}/other` } }));
    expect([r.verdict, r.code]).toEqual(["blocked", "RESOURCE_URL_MISMATCH"]);
  });

  it("allows a price drop and reports it as a note", () => {
    const r = checkAgainstLock(lockFor(), "GET", URL_, pr({ amount: "5000" }));
    expect([r.verdict, r.code]).toEqual(["allowed", "OK"]);
    expect(r.notes).toHaveLength(1);
  });

  it("needs your OK when only un-modelled terms changed, and blocks once the owner tightened that code", () => {
    const changed = pr({ extra: { name: "USDC", version: "3" } });
    const r = checkAgainstLock(lockFor(), "GET", URL_, changed);
    expect([r.verdict, r.code]).toEqual(["needsOk", "TERMS_CHANGED_OTHER"]);
    expect(r.detail.startsWith("Needs your OK: ")).toBe(true);
    const t = checkAgainstLock(lockFor(["TERMS_CHANGED_OTHER"]), "GET", URL_, changed);
    expect([t.verdict, t.code]).toEqual(["blocked", "TERMS_CHANGED_OTHER"]);
  });

  it("reports the worst finding: a blocked code wins over a needs-your-OK code", () => {
    const r = checkAgainstLock(lockFor(), "GET", URL_, pr({ payTo: OTHER_PAY, extra: { version: "3" } }));
    expect(r.code).toBe("PAYTO_CHANGED");
    expect(r.findings.map((f) => f.code)).toContain("PAYTO_CHANGED");
  });

  it("blocks unreadable requirements (fail closed)", () => {
    for (const bad of [null, "garbage", { x402Version: 2 }, pr({ amount: 10000 })]) {
      const r = checkAgainstLock(lockFor(), "GET", URL_, bad);
      expect([r.verdict, r.code]).toEqual(["blocked", "REQUIREMENTS_UNREADABLE"]);
    }
  });

  it("blocks an endpoint that is not in the lock, an unsupported method and a URL it cannot read", () => {
    for (const [method, url] of [
      ["GET", "https://shop.example.com/v1/other"],
      ["POST", URL_],
      ["PUT", URL_],
      ["GET", "not a url"],
      ["GET", "http://shop.example.com/v1/forecast"],
    ] as const) {
      const r = checkAgainstLock(lockFor(), method, url, pr());
      expect([r.verdict, r.code]).toEqual(["blocked", "NOT_IN_LOCK"]);
    }
  });

  it("matches the lock entry after URL normalisation (scheme and host case, default port)", () => {
    const r = checkAgainstLock(lockFor(), "get", "HTTPS://Shop.Example.com:443/v1/forecast", pr());
    expect([r.verdict, r.code]).toEqual(["allowed", "OK"]);
  });

  it("reads x402 v1 bodies too", () => {
    const v1 = {
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "base-sepolia",
          maxAmountRequired: "10000",
          asset: ASSET,
          payTo: PAY,
          resource: URL_,
          maxTimeoutSeconds: 60,
          extra: { name: "USDC", version: "2" },
        },
      ],
    };
    const r = checkAgainstLock(lockFor(), "GET", URL_, v1);
    // Same option, older protocol version: the owner reviews the switch.
    expect([r.verdict, r.code]).toEqual(["needsOk", "PROTOCOL_VERSION_CHANGED"]);
  });

  it("property: never throws; verdict, code and detail always agree with the three verdict strings", () => {
    const lock = lockFor();
    fc.assert(
      fc.property(fc.anything(), fc.string(), fc.string(), (value, method, url) => {
        const r = checkAgainstLock(lock, method, url, value);
        expect(Object.keys(VERDICTS)).toContain(r.verdict);
        expect(REASON_CODES).toContain(r.code);
        expect(r.detail.split(": ")[0]).toBe(decode(r.code).split(": ")[0]);
      }),
    );
  });

  it("property: any payTo other than the pinned one is always blocked", () => {
    const lock = lockFor();
    fc.assert(
      fc.property(
        fc.stringMatching(/^0x[0-9a-fA-F]{40}$/u).filter((a) => a.toLowerCase() !== PAY.toLowerCase()),
        (payTo) => {
          expect(checkAgainstLock(lock, "GET", URL_, pr({ payTo })).verdict).toBe("blocked");
        },
      ),
    );
  });
});

describe("checkResponse (a raw unpaid HTTP response, for fetch wrappers)", () => {
  it("reads the PAYMENT-REQUIRED header of a 402", () => {
    const r = checkResponse(lockFor(), "GET", URL_, {
      status: 402,
      headers: { "payment-required": header(pr()) },
      body: "",
    });
    expect([r.verdict, r.code]).toEqual(["allowed", "OK"]);
  });

  it("finds the header whatever its case", () => {
    const r = checkResponse(lockFor(), "GET", URL_, {
      status: 402,
      headers: { "Payment-Required": header(pr({ payTo: OTHER_PAY })) },
      body: "",
    });
    expect(r.code).toBe("PAYTO_CHANGED");
  });

  it("needs your OK when the endpoint did not answer 402, and blocks a garbage header", () => {
    const ok = checkResponse(lockFor(), "GET", URL_, { status: 200, headers: {}, body: "" });
    expect([ok.verdict, ok.code]).toEqual(["needsOk", "ENDPOINT_NOT_402"]);
    const bad = checkResponse(lockFor(), "GET", URL_, {
      status: 402,
      headers: { "payment-required": "not*base64" },
      body: "",
    });
    expect([bad.verdict, bad.code]).toEqual(["blocked", "REQUIREMENTS_UNREADABLE"]);
  });

  it("blocks an endpoint that is not in the lock without reading the response", () => {
    const r = checkResponse(lockFor(), "GET", "https://shop.example.com/x", { status: 402, headers: {}, body: "" });
    expect(r.code).toBe("NOT_IN_LOCK");
  });
});

describe("checkSelected (the one option the client is about to pay)", () => {
  const selected = (req: Record<string, unknown> = {}): Record<string, unknown> => {
    const [first] = pr(req)["accepts"] as Record<string, unknown>[];
    return first ?? {};
  };

  it("allows a pinned option within its maximum", () => {
    const r = checkSelected(lockFor(), "GET", URL_, pr(), selected());
    expect([r.verdict, r.code]).toEqual(["allowed", "OK"]);
  });

  it("checks the selected option itself, not only what the seller listed", () => {
    // A client policy may transform the requirements before selection: the selected option is re-checked.
    expect(checkSelected(lockFor(), "GET", URL_, pr(), selected({ payTo: OTHER_PAY })).code).toBe("PAYTO_CHANGED");
    expect(checkSelected(lockFor(), "GET", URL_, pr(), selected({ amount: "10001" })).code).toBe("PRICE_ABOVE_LOCK");
    expect(checkSelected(lockFor(), "GET", URL_, pr(), selected({ network: "eip155:8453" })).code).toBe(
      "NETWORK_CHANGED",
    );
  });

  it("does not report the other pinned options the client did not select as removed", () => {
    const two = pr({}, {});
    const second = { ...selected(), payTo: OTHER_PAY };
    (two["accepts"] as unknown[]).push(second);
    const parsed = parsePaymentRequired(two);
    if (!parsed.ok) throw new Error(parsed.reason);
    const lock = emptyLock();
    lock.endpoints[endpointKey("GET", URL_)] = newEndpoint(parsed.terms, { toleranceBps: 0 });
    const r = checkSelected(lock, "GET", URL_, two, second);
    expect([r.verdict, r.code, r.findings]).toEqual(["allowed", "OK", []]);
  });

  it("blocks when the resource URL, method or URL do not match, or the input is unreadable", () => {
    const other = pr({}, { resource: { url: `${URL_}/x` } });
    expect(checkSelected(lockFor(), "GET", URL_, other, selected()).code).toBe("RESOURCE_URL_MISMATCH");
    expect(checkSelected(lockFor(), "PUT", URL_, pr(), selected()).code).toBe("NOT_IN_LOCK");
    for (const [paymentRequired, sel] of [
      [null, selected()],
      [pr(), null],
      [pr(), "x"],
      ["garbage", selected()],
    ] as const) {
      const r = checkSelected(lockFor(), "GET", URL_, paymentRequired, sel);
      expect([r.verdict, r.code]).toEqual(["blocked", "REQUIREMENTS_UNREADABLE"]);
    }
  });

  it("property: never throws", () => {
    const lock = lockFor();
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (a, b) => {
        expect(Object.keys(VERDICTS)).toContain(checkSelected(lock, "GET", URL_, a, b).verdict);
      }),
    );
  });
});

describe("allows (which verdicts let a payment go ahead)", () => {
  it("lets only Allowed through by default, and Needs your OK too only when loosened", () => {
    const base = { code: "OK", detail: "", findings: [], notes: [] } as const;
    expect(allows({ ...base, verdict: "allowed" })).toBe(true);
    expect(allows({ ...base, verdict: "needsOk" })).toBe(false);
    expect(allows({ ...base, verdict: "needsOk" }, "blocked")).toBe(true);
    expect(allows({ ...base, verdict: "blocked" }, "blocked")).toBe(false);
  });
});

describe("checkResponse with MPP challenges (D-027)", () => {
  // draft-httpauth-payment-01 §5.1.2.2 example request, served for this test's URL.
  const challenge = (recipient: string): string => {
    const request = Buffer.from(`{"amount":"1000","currency":"usd","recipient":"${recipient}"}`).toString("base64url");
    return `Payment id="x7Tg2pLqR9mKvNwY3hBcZa", realm="shop.example.com", method="example", intent="charge", request="${request}"`;
  };
  const response = (recipient: string) => ({
    status: 402,
    headers: { "WWW-Authenticate": challenge(recipient) },
    body: "",
  });

  function mppLock(): Lock {
    const lock = emptyLock();
    const n = normalizeTerms({
      protocol: "mpp",
      resourceUrl: URL_,
      envelope: {},
      options: [
        {
          scheme: "charge",
          network: "mpp:example",
          asset: "usd",
          payTo: "acct_123",
          amount: "1000",
          maxTimeoutSeconds: 0,
          paymentFlow: "authorization",
          assetTransferMethod: null,
          extra: { realm: "shop.example.com" },
          otherFields: {},
        },
      ],
    });
    if (!n.ok) throw new Error(n.reason);
    lock.endpoints[endpointKey("GET", URL_)] = newEndpoint(n.terms, { toleranceBps: 0 });
    return lock;
  }

  it("allows the pinned MPP terms and blocks another recipient", () => {
    const lock = mppLock();
    expect(checkResponse(lock, "GET", URL_, response("acct_123")).code).toBe("OK");
    const r = checkResponse(lock, "GET", URL_, response("acct_999"));
    expect([r.verdict, r.code]).toEqual(["blocked", "PAYTO_CHANGED"]);
  });
});
