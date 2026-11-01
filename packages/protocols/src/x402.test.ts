// Written with AI help.
import { emptyLock, endpointKey, integrityOf, newEndpoint, normalizeTerms, verifyEndpoint } from "@paid-lock/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { observe402 } from "./observe.ts";
import { parseX402V1Body, parseX402V2Header, type ParseResult } from "./x402.ts";

// x402 specs/transports-v2/http.md, "Payment Required Signaling" example header (x402 @ e208bd3).
const SPEC_V2_HEADER =
  "eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQQVlNRU5ULVNJR05BVFVSRSBoZWFkZXIgaXMgcmVxdWlyZWQiLCJyZXNvdXJjZSI6eyJ1cmwiOiJodHRwczovL2FwaS5leGFtcGxlLmNvbS9wcmVtaXVtLWRhdGEiLCJkZXNjcmlwdGlvbiI6IkFjY2VzcyB0byBwcmVtaXVtIG1hcmtldCBkYXRhIiwibWltZVR5cGUiOiJhcHBsaWNhdGlvbi9qc29uIn0sImFjY2VwdHMiOlt7InNjaGVtZSI6ImV4YWN0IiwibmV0d29yayI6ImVpcDE1NTo4NDUzMiIsImFtb3VudCI6IjEwMDAwIiwiYXNzZXQiOiIweDAzNkNiRDUzODQyYzU0MjY2MzRlNzkyOTU0MWVDMjMxOGYzZENGN2UiLCJwYXlUbyI6IjB4MjA5NjkzQmM2YWZjMEM1MzI4YkEzNkZhRjAzQzUxNEVGMzEyMjg3QyIsIm1heFRpbWVvdXRTZWNvbmRzIjo2MCwiZXh0cmEiOnsibmFtZSI6IlVTREMiLCJ2ZXJzaW9uIjoiMiJ9fV19";

const RESOURCE = "https://api.example.com/premium-data";
const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PAY = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

type Obj = Record<string, unknown>;
const v2 = (over: Obj = {}, req: Obj = {}): Obj => ({
  x402Version: 2,
  error: "payment required",
  resource: { url: RESOURCE, description: "Access to premium market data" },
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
  ...over,
});
const header = (obj: unknown): string => Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
const parseV2 = (over: Obj = {}, req: Obj = {}): ParseResult => parseX402V2Header(header(v2(over, req)));
const terms = (r: ParseResult) => {
  if (!r.ok) throw new Error(r.reason);
  return r.terms;
};
const envelopeHash = (r: ParseResult): string => integrityOf(terms(r).envelope);

// x402 specs/x402-specification-v1.md §5.1.1 example body.
const v1 = (req: Obj = {}, over: Obj = {}): string =>
  JSON.stringify({
    x402Version: 1,
    error: "payment required",
    accepts: [
      {
        scheme: "exact",
        network: "base-sepolia",
        maxAmountRequired: "10000",
        asset: ASSET,
        payTo: PAY,
        resource: RESOURCE,
        description: "Access to premium market data",
        mimeType: "application/json",
        outputSchema: null,
        maxTimeoutSeconds: 60,
        extra: { name: "USDC", version: "2" },
        ...req,
      },
    ],
    ...over,
  });

describe("x402 v2 header", () => {
  it("reads the spec's own example header", () => {
    const t = terms(parseX402V2Header(SPEC_V2_HEADER));
    expect(t.x402Version).toBe(2);
    expect(t.resourceUrl).toBe(RESOURCE);
    expect(t.options).toEqual([
      {
        scheme: "exact",
        network: "eip155:84532",
        asset: ASSET,
        payTo: PAY,
        amount: "10000",
        maxTimeoutSeconds: 60,
        paymentFlow: "authorization",
        assetTransferMethod: null,
        extra: { name: "USDC", version: "2" },
        otherFields: {},
      },
    ]);
    expect(normalizeTerms(t).ok).toBe(true);
  });

  it("splits the reserved extra keys (v2 §6.1) and keeps the rest", () => {
    const o = terms(parseV2({}, { extra: { paymentFlow: "upfront", assetTransferMethod: "permit2", name: "USDC" } }))
      .options[0];
    expect(o).toMatchObject({ paymentFlow: "upfront", assetTransferMethod: "permit2", extra: { name: "USDC" } });
  });

  it("captures unknown fields so drift in them stays visible", () => {
    const t = terms(parseV2({ surprise: 1 }, { fee: "5" }));
    expect(t.options[0]?.otherFields).toEqual({ fee: "5" });
    expect(t.envelope).toEqual({ extensions: {}, otherFields: { surprise: 1 } });
  });

  it("ignores the error message and descriptive resource fields", () => {
    const base = envelopeHash(parseV2());
    expect(
      envelopeHash(parseV2({ error: "something else", resource: { url: RESOURCE, description: "new", tags: ["x"] } })),
    ).toBe(base);
  });

  const siwx = (nonce: string, issuedAt: string, statement = "Sign in") => ({
    "sign-in-with-x": {
      info: {
        domain: "api.example.com",
        uri: RESOURCE,
        version: "1",
        nonce,
        issuedAt,
        expirationTime: issuedAt,
        requestId: nonce,
        statement,
      },
      supportedChains: [{ chainId: "eip155:8453", type: "eip191" }],
      schema: { type: "object" },
    },
  });

  it("nonce-only change: sign-in-with-x per-request fields do not change the envelope hash", () => {
    const a = parseV2({ extensions: siwx("a1b2c3d4e5f67890a1b2c3d4e5f67890", "2026-11-01T10:00:00.000Z") });
    const b = parseV2({ extensions: siwx("ffffffffffffffffffffffffffffffff", "2026-11-01T10:05:00.000Z") });
    expect(envelopeHash(a)).toBe(envelopeHash(b));
    expect(envelopeHash(parseV2({ extensions: siwx("a", "t", "Different statement") }))).not.toBe(envelopeHash(a));
  });

  it("nonce-only change verifies as allowed end to end", () => {
    const first = terms(parseV2({ extensions: siwx("a1b2c3d4e5f67890a1b2c3d4e5f67890", "2026-11-01T10:00:00.000Z") }));
    const n = normalizeTerms(first);
    if (!n.ok) throw new Error(n.reason);
    const key = endpointKey("GET", RESOURCE);
    const lock = emptyLock();
    lock.endpoints[key] = newEndpoint(n.terms, { toleranceBps: 0 });
    const later = terms(parseV2({ extensions: siwx("0123456789abcdef0123456789abcdef", "2026-11-01T11:00:00.000Z") }));
    expect(verifyEndpoint(lock, key, { kind: "terms", terms: later }).verdict).toBe("allowed");
  });

  it("leaves offer-receipt out of the envelope, but other extension changes count", () => {
    const base = envelopeHash(parseV2());
    expect(envelopeHash(parseV2({ extensions: { "offer-receipt": { info: { offers: [{ validUntil: 1 }] } } } }))).toBe(
      base,
    );
    expect(envelopeHash(parseV2({ extensions: { bazaar: { info: { category: "x" }, schema: {} } } }))).not.toBe(base);
  });

  it.each<[string, string]>([
    ["bad Base64", "%%%"],
    ["not JSON", Buffer.from("hello").toString("base64")],
    ["x402Version 1 in the v2 header", header(v2({ x402Version: 1 }))],
    ["no accepts", header(v2({ accepts: [] }))],
    ["too many accepts", header(v2({ accepts: Array.from({ length: 65 }, () => (v2()["accepts"] as Obj[])[0]) }))],
    ["amount as a number", header(v2({}, { amount: 10000 }))],
    ["missing payTo", header(v2({}, { payTo: undefined }))],
    ["missing resource", header(v2({ resource: undefined }))],
    ["non-string paymentFlow", header(v2({}, { extra: { paymentFlow: 1 } }))],
    ["non-string assetTransferMethod", header(v2({}, { extra: { assetTransferMethod: false } }))],
    [
      "duplicate payTo keys",
      Buffer.from(
        JSON.stringify(v2()).replace(
          `"payTo":"${PAY}"`,
          `"payTo":"${PAY}","payTo":"0x0000000000000000000000000000000000002002"`,
        ),
      ).toString("base64"),
    ],
    ["an oversized header", "A".repeat(128 * 1024 + 4)],
  ])("refuses %s", (_name, value) => {
    const r = parseX402V2Header(value);
    expect(r.ok).toBe(false);
  });
});

describe("x402 v1 body", () => {
  it("reads the v1 spec example and maps the network to CAIP-2", () => {
    const t = terms(parseX402V1Body(v1()));
    expect(t.x402Version).toBe(1);
    expect(t.resourceUrl).toBe(RESOURCE);
    expect(t.options[0]).toMatchObject({ network: "eip155:84532", amount: "10000", otherFields: {} });
    expect(normalizeTerms(t).ok).toBe(true);
  });

  it("accepts extra: null and keeps unknown fields", () => {
    const t = terms(parseX402V1Body(v1({ extra: null, fee: "1" }, { surprise: true })));
    expect(t.options[0]?.extra).toEqual({});
    expect(t.options[0]?.otherFields).toEqual({ fee: "1" });
    expect(t.envelope).toEqual({ extensions: {}, otherFields: { surprise: true } });
  });

  it.each<[string, string]>([
    ["an unknown network name (never guessed)", v1({ network: "base-mainnet" })],
    ["a CAIP-2 network in a v1 body", v1({ network: "eip155:84532" })],
    [
      "accepts naming different resources",
      JSON.stringify({
        ...(JSON.parse(v1()) as Obj),
        accepts: [
          (JSON.parse(v1()) as { accepts: Obj[] }).accepts[0],
          { ...(JSON.parse(v1()) as { accepts: Obj[] }).accepts[0], resource: "https://other.example/x" },
        ],
      }),
    ],
    ["x402Version 2 in a v1 body", v1({}, { x402Version: 2 })],
    ["maxAmountRequired missing", v1({ maxAmountRequired: undefined })],
    ["not JSON", "<html>402</html>"],
    ["non-string paymentFlow", v1({ extra: { paymentFlow: [] } })],
  ])("refuses %s", (_name, body) => {
    expect(parseX402V1Body(body).ok).toBe(false);
  });
});

describe("observe402", () => {
  it("reports a non-402 status", () => {
    expect(observe402({ status: 200, headers: {}, body: "" })).toEqual({ kind: "not402", status: 200 });
  });

  it("prefers the v2 header over the body", () => {
    const o = observe402({ status: 402, headers: { "payment-required": SPEC_V2_HEADER }, body: v1() });
    expect(o.kind === "terms" && o.terms.x402Version).toBe(2);
  });

  it("does not fall back to the body when the header is unreadable", () => {
    expect(observe402({ status: 402, headers: { "payment-required": "%%%" }, body: v1() }).kind).toBe("unreadable");
  });

  it("reads a v1 body when there is no header, and refuses a 402 with neither", () => {
    expect(observe402({ status: 402, headers: {}, body: v1() }).kind).toBe("terms");
    expect(observe402({ status: 402, headers: {}, body: "{}" }).kind).toBe("unreadable");
  });

  it("version bump fixture: a v2-locked endpoint now answering v1 needs your OK", () => {
    const n = normalizeTerms(terms(parseX402V2Header(SPEC_V2_HEADER)));
    if (!n.ok) throw new Error(n.reason);
    const key = endpointKey("GET", RESOURCE);
    const lock = emptyLock();
    lock.endpoints[key] = newEndpoint(n.terms, { toleranceBps: 0 });
    const r = verifyEndpoint(lock, key, observe402({ status: 402, headers: {}, body: v1() }));
    expect(r.findings.map((f) => f.code)).toEqual(["PROTOCOL_VERSION_CHANGED"]);
    expect(r.verdict).toBe("needsOk");
  });
});

describe("fuzz", () => {
  const neverThrows = (f: () => unknown) => {
    expect(f).not.toThrow();
  };

  it("arbitrary header text never throws", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (s) => {
        neverThrows(() => parseX402V2Header(s));
      }),
      { numRuns: 500 },
    );
  });

  it("arbitrary JSON in a valid Base64 header never throws, and any accepted result normalises without throwing", () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 6 }), (v) => {
        const r = parseX402V2Header(header(v));
        if (r.ok) neverThrows(() => normalizeTerms(r.terms));
      }),
      { numRuns: 500 },
    );
  });

  it("mutated spec examples never throw (field deleted or replaced by any JSON value)", () => {
    const fields = [
      "x402Version",
      "resource",
      "accepts",
      "extensions",
      "scheme",
      "network",
      "amount",
      "asset",
      "payTo",
      "maxTimeoutSeconds",
      "extra",
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...fields),
        fc.option(fc.jsonValue({ maxDepth: 3 }), { nil: undefined }),
        (field, value) => {
          const top = ["x402Version", "resource", "accepts", "extensions"].includes(field);
          const r = top ? parseV2({ [field]: value }) : parseV2({}, { [field]: value });
          if (r.ok) neverThrows(() => normalizeTerms(r.terms));
          const b = top ? parseX402V1Body(v1({}, { [field]: value })) : parseX402V1Body(v1({ [field]: value }));
          if (b.ok) neverThrows(() => normalizeTerms(b.terms));
        },
      ),
      { numRuns: 500 },
    );
  });

  it("arbitrary body text never throws", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (s) => {
        neverThrows(() => parseX402V1Body(s));
      }),
      { numRuns: 500 },
    );
  });
});
