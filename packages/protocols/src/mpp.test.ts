// MPP "Payment" challenges. Field names: docs/SPEC_SOURCES.md, MPP section (draft-httpauth-payment-01,
// draft-payment-intent-charge-00, mpp.dev/protocol/challenges, read 2 Nov 2026).
import {
  canonicalize,
  emptyLock,
  endpointKey,
  newEndpoint,
  normalizeTerms,
  verifyEndpoint,
  type Json,
} from "@paid-lock/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseChallenges, readMpp } from "./mpp.ts";
import { observe402 } from "./observe.ts";

const URL_ = "https://api.example.com/v1/forecast";

// draft-httpauth-payment-01 §5.1.2.2 example (folded onto one line; obs-fold is not valid HTTP).
const SPEC_EXAMPLE =
  'Payment id="x7Tg2pLqR9mKvNwY3hBcZa", realm="api.example.com", method="example", intent="charge", ' +
  'expires="2025-01-15T12:05:00Z", request="eyJhbW91bnQiOiIxMDAwIiwiY3VycmVuY3kiOiJ1c2QiLCJyZWNpcGllbnQiOiJhY2N0XzEyMyJ9"';

// draft-payment-intent-charge-00 §5.4.2 (Tempo) request; the recipient is the draft's example address.
const TEMPO_REQUEST = {
  amount: "1000000",
  currency: "0x20c0000000000000000000000000000000000000",
  recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
  methodDetails: { chainId: 4217, feePayer: true },
};

const b64url = (text: string): string => Buffer.from(text, "utf8").toString("base64url");
const req = (value: Record<string, unknown>): string => b64url(canonicalize(value as Json));

interface Ch {
  id?: string;
  realm?: string;
  method?: string;
  intent?: string;
  request?: string;
  expires?: string;
  opaque?: string;
  digest?: string;
  description?: string;
  [k: string]: string | undefined;
}
function challenge(over: Ch = {}): string {
  const p: Ch = {
    id: "x7Tg2pLqR9mKvNwY3hBcZa",
    realm: "api.example.com",
    method: "tempo",
    intent: "charge",
    expires: "2026-11-02T12:05:00Z",
    request: req(TEMPO_REQUEST),
    ...over,
  };
  const params = Object.entries(p)
    .filter((e): e is [string, string] => e[1] !== undefined)
    .map(([k, v]) => `${k}="${v}"`);
  return `Payment ${params.join(", ")}`;
}
const terms = (header: string) => {
  const r = readMpp(header, URL_);
  if (r.kind !== "terms") throw new Error(`expected terms, got ${JSON.stringify(r)}`);
  return r.terms;
};

describe("parseChallenges (RFC 9110 §11.6.1 challenge list)", () => {
  it("reads auth-params with tokens and quoted strings, case-insensitive names", () => {
    expect(parseChallenges('Payment ID="a b", Realm=x, method="m\\"q"')).toEqual({
      ok: true,
      challenges: [{ scheme: "payment", params: { id: "a b", realm: "x", method: 'm"q' } }],
    });
  });

  it("splits several challenges in one field value (Node joins repeated headers with ', ')", () => {
    const r = parseChallenges('Bearer realm="a", error="x", Payment id="1", method="tempo", Negotiate abc==, Basic');
    expect(r.ok && r.challenges.map((c) => c.scheme)).toEqual(["bearer", "payment", "negotiate", "basic"]);
    expect(r.ok && r.challenges[2]?.token68).toBe("abc==");
  });

  it.each([
    ['Payment id="1", id="2"', "duplicate"],
    ['Payment id="unterminated', "quoted"],
    ["Payment a=b, id=", "value"],
    ['Payment id="a\u0001b"', "control"],
    ["=x", "scheme"],
  ])("refuses %j", (header, word) => {
    const r = parseChallenges(header);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain(word);
  });

  it("property: never throws", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        expect(typeof parseChallenges(s).ok).toBe("boolean");
      }),
    );
  });
});

describe("readMpp", () => {
  it("reads the draft's own example challenge", () => {
    const t = terms(SPEC_EXAMPLE);
    expect(t.protocol).toBe("mpp");
    expect(t.resourceUrl).toBe(URL_);
    expect(t.options).toEqual([
      {
        scheme: "charge",
        network: "mpp:example",
        asset: "usd",
        payTo: "acct_123",
        amount: "1000",
        maxTimeoutSeconds: 0,
        paymentFlow: "authorization",
        assetTransferMethod: null,
        extra: { realm: "api.example.com" },
        otherFields: {},
      },
    ]);
    expect(normalizeTerms(t).ok).toBe(true);
  });

  it("pins methodDetails with the terms and keeps unknown request fields visible", () => {
    const t = terms(
      challenge({ request: req({ ...TEMPO_REQUEST, futureField: 1, description: "x", externalId: "o-1" }) }),
    );
    expect(t.options[0]?.extra).toEqual({ realm: "api.example.com", methodDetails: { chainId: 4217, feePayer: true } });
    expect(t.options[0]?.otherFields).toEqual({ futureField: 1 });
  });

  it("uses the realm as payTo when the request names no recipient (recipient is optional for some methods)", () => {
    const noRecipient: Record<string, unknown> = { ...TEMPO_REQUEST };
    delete noRecipient["recipient"];
    expect(terms(challenge({ request: req(noRecipient) })).options[0]?.payTo).toBe("realm:api.example.com");
  });

  it("reads one option per Payment challenge and ignores other schemes", () => {
    const header = `Bearer realm="x", ${challenge()}, ${challenge({ id: "def", method: "stripe", request: req({ amount: "50", currency: "usd" }) })}`;
    expect(terms(header).options.map((o) => o.network)).toEqual(["mpp:tempo", "mpp:stripe"]);
  });

  it("says none when no Payment challenge is present", () => {
    expect(readMpp('Bearer realm="x"', URL_)).toEqual({ kind: "none" });
  });

  it("property: id, expires, opaque, digest and description never change the terms", () => {
    const base = terms(challenge());
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9_-]{1,40}$/u),
        fc.stringMatching(/^[A-Za-z0-9:.-]{1,40}$/u),
        fc.stringMatching(/^[A-Za-z0-9_-]{0,40}$/u),
        fc.stringMatching(/^[A-Za-z0-9 :=-]{0,40}$/u),
        (id, expires, opaque, description) => {
          const t = terms(challenge({ id, expires, opaque, digest: `sha-256=:${opaque}:`, description }));
          expect(t).toEqual(base);
        },
      ),
    );
  });

  it("catches recipient, currency, amount and method changes against the lock (M5 acceptance)", () => {
    const n = normalizeTerms(terms(challenge()));
    if (!n.ok) throw new Error(n.reason);
    const lock = emptyLock();
    const key = endpointKey("GET", URL_);
    lock.endpoints[key] = newEndpoint(n.terms, { toleranceBps: 0 });
    const verdict = (request: Record<string, unknown>, over: Ch = {}) => {
      const r = verifyEndpoint(lock, key, {
        kind: "terms",
        terms: terms(challenge({ request: req(request), ...over })),
      });
      return [r.verdict, r.findings.map((f) => f.code)];
    };
    expect(verdict(TEMPO_REQUEST, { id: "other", expires: "2030-01-01T00:00:00Z", opaque: "eyJ4IjoieSJ9" })).toEqual([
      "allowed",
      [],
    ]);
    expect(verdict({ ...TEMPO_REQUEST, recipient: "0x000000000000000000000000000000000000dEaD" })).toEqual([
      "blocked",
      ["PAYTO_CHANGED"],
    ]);
    expect(verdict({ ...TEMPO_REQUEST, currency: "usd" })).toEqual(["blocked", ["ASSET_CHANGED"]]);
    expect(verdict({ ...TEMPO_REQUEST, amount: "1000001" })).toEqual(["blocked", ["PRICE_ABOVE_LOCK"]]);
    expect(verdict({ ...TEMPO_REQUEST, amount: "1" })[0]).toBe("allowed");
    expect(verdict(TEMPO_REQUEST, { method: "other" })).toEqual(["blocked", ["NETWORK_CHANGED"]]);
    expect(verdict({ ...TEMPO_REQUEST, methodDetails: { chainId: 1, feePayer: true } })).toEqual([
      "needsOk",
      ["TERMS_CHANGED_OTHER"],
    ]);
    expect(verdict(TEMPO_REQUEST, { realm: "other.example.com" })).toEqual(["needsOk", ["TERMS_CHANGED_OTHER"]]);
  });

  it.each([
    ["no id", { id: "" }, "id"],
    ["no realm", { realm: undefined }, "realm"],
    ["no request", { request: undefined }, "request"],
    ["uppercase method", { method: "Tempo" }, "method"],
    ["unknown intent", { intent: "session" }, "intent"],
    ["padded base64url", { request: `${req(TEMPO_REQUEST)}=` }, "base64url"],
    [
      "standard base64",
      { request: Buffer.from(canonicalize(TEMPO_REQUEST)).toString("base64").replace(/=+$/u, "") + "+/" },
      "base64url",
    ],
    ["request not JCS", { request: b64url(JSON.stringify({ currency: "usd", amount: "1" })) }, "JCS"],
    ["request not an object", { request: req([1] as unknown as Record<string, unknown>) }, "object"],
    ["amount missing", { request: req({ currency: "usd" }) }, "amount"],
    ["amount not a string", { request: req({ amount: 1, currency: "usd" }) }, "amount"],
  ])("is unreadable with %s", (_name, over, word) => {
    const r = readMpp(challenge(over as Ch), URL_);
    expect(r.kind).toBe("unreadable");
    expect(r.kind === "unreadable" && r.reason).toContain(word);
  });

  it("is unreadable with token68 credentials, a malformed header, or one that is too large", () => {
    expect(readMpp("Payment abc==", URL_).kind).toBe("unreadable");
    expect(readMpp('Payment id="x', URL_).kind).toBe("unreadable");
    expect(readMpp(`${challenge()}, x="${"a".repeat(128 * 1024)}"`, URL_).kind).toBe("unreadable");
  });

  it("property: never throws", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        expect(["none", "terms", "unreadable"]).toContain(readMpp(`Payment ${s}`, URL_).kind);
      }),
    );
  });
});

describe("observe402 with MPP", () => {
  const v2Header = Buffer.from(
    JSON.stringify({
      x402Version: 2,
      resource: { url: URL_ },
      accepts: [
        {
          scheme: "exact",
          network: "eip155:84532",
          amount: "10000",
          asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          payTo: "0x0000000000000000000000000000000000001001",
          maxTimeoutSeconds: 60,
        },
      ],
    }),
  ).toString("base64");

  it("reads MPP terms from WWW-Authenticate", () => {
    const o = observe402({ status: 402, headers: { "www-authenticate": challenge() }, body: "", url: URL_ });
    expect(o.kind === "terms" && o.terms.protocol).toBe("mpp");
  });

  it("is unreadable when the response offers both x402 and MPP terms (ambiguous, fail closed)", () => {
    const both = observe402({
      status: 402,
      headers: { "payment-required": v2Header, "www-authenticate": challenge() },
      body: "",
      url: URL_,
    });
    expect(both).toEqual({ kind: "unreadable", reason: "the response offers both x402 and MPP payment terms" });
  });

  it("is unreadable when MPP challenges come with an x402 v1 body", () => {
    const body = JSON.stringify({
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "base-sepolia",
          maxAmountRequired: "1",
          asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          payTo: "0x0000000000000000000000000000000000001001",
          resource: URL_,
          maxTimeoutSeconds: 60,
        },
      ],
    });
    expect(observe402({ status: 402, headers: { "www-authenticate": challenge() }, body, url: URL_ })).toEqual({
      kind: "unreadable",
      reason: "the response offers both x402 and MPP payment terms",
    });
    const plain = observe402({ status: 402, headers: { "www-authenticate": challenge() }, body: "{}", url: URL_ });
    expect(plain.kind).toBe("terms");
  });

  it("reports why MPP terms are unreadable", () => {
    const o = observe402({
      status: 402,
      headers: { "www-authenticate": challenge({ intent: "x" }) },
      body: "",
      url: URL_,
    });
    expect(o.kind === "unreadable" && o.reason).toContain("intent");
  });

  it("needs the request URL for MPP terms", () => {
    expect(observe402({ status: 402, headers: { "www-authenticate": challenge() }, body: "" })).toMatchObject({
      kind: "unreadable",
    });
  });

  it("falls back to x402 when WWW-Authenticate has no Payment challenge", () => {
    const o = observe402({
      status: 402,
      headers: { "payment-required": v2Header, "www-authenticate": 'Bearer realm="x"' },
      body: "",
      url: URL_,
    });
    expect(o.kind === "terms" && o.terms.protocol).toBe("x402");
  });
});
