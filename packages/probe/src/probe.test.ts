// Written with AI help.
import { parseScenario, startMockSeller, type MockSeller } from "@paid-lock/mock-seller";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probe } from "./probe.ts";
import { ProbeUrlError } from "./url-policy.ts";

const PAY = "0x0000000000000000000000000000000000001001";
const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const base = { scheme: "exact", asset: ASSET, payTo: PAY, maxTimeoutSeconds: 60 };
const accepts = [{ ...base, network: "eip155:84532", amount: "10000" }];
const acceptsV1 = [
  { ...base, network: "base-sepolia", maxAmountRequired: "10000", resource: "${origin}/v1", description: "" },
];

const scenario = parseScenario({
  _label: "Written with AI help, test fixture. Fake payTo; asset is Base Sepolia (testnet) USDC.",
  name: "probe-tests",
  routes: [
    {
      method: "GET",
      path: "/v2",
      respond: { kind: "x402-v2", paymentRequired: { x402Version: 2, resource: { url: "${origin}/v2" }, accepts } },
    },
    {
      method: "POST",
      path: "/v2",
      respond: { kind: "x402-v2", paymentRequired: { x402Version: 2, resource: { url: "${origin}/v2" }, accepts } },
    },
    {
      method: "GET",
      path: "/v1",
      respond: { kind: "x402-v1", body: { x402Version: 1, error: "", accepts: acceptsV1 } },
    },
    { method: "GET", path: "/free", respond: { kind: "raw", status: 200, body: "free" } },
    {
      method: "GET",
      path: "/away",
      respond: { kind: "raw", status: 302, headers: { location: "https://other.example/x" } },
    },
    { method: "GET", path: "/near", respond: { kind: "raw", status: 307, headers: { location: "${origin}/v2" } } },
    { method: "GET", path: "/noloc", respond: { kind: "raw", status: 301 } },
    { method: "GET", path: "/badloc", respond: { kind: "raw", status: 302, headers: { location: "http://[bad" } } },
    {
      method: "GET",
      path: "/garbage",
      respond: { kind: "raw", status: 402, headers: { "PAYMENT-REQUIRED": "%%%not-base64%%%" } },
    },
    { method: "GET", path: "/big", respond: { kind: "raw", status: 402, bodyBytes: 4096 } },
    { method: "GET", path: "/slow", delayMs: 2000, respond: { kind: "raw", status: 402 } },
  ],
});

let seller: MockSeller;
beforeAll(async () => {
  seller = await startMockSeller({ scenario });
});
afterAll(async () => {
  await seller.close();
});

/** Request header names a plain unpaid fetch may send. Nothing else, in particular no auth, cookie or payment header. */
const ALLOWED_HEADER_NAMES = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "connection",
  "content-length",
  "content-type",
  "host",
  "sec-fetch-mode",
  "user-agent",
]);

describe("probe against the mock seller", () => {
  it("reads x402 v2 terms twice and sends no payment, auth or cookie header", async () => {
    const before = seller.stats().requests;
    const r = await probe(`${seller.origin}/v2`);
    expect(r.samples.map((s) => s.kind)).toEqual(["terms", "terms"]);
    const stats = seller.stats();
    expect(stats.requests - before).toBe(2);
    expect(stats.paymentHeadersSeen).toBe(0);
    expect(stats.requestHeaderNames.filter((n) => !ALLOWED_HEADER_NAMES.has(n))).toEqual([]);
  });

  it("reads x402 v1 bodies", async () => {
    const r = await probe(`${seller.origin}/v1`, { samples: 1 });
    expect(r.samples[0]?.kind === "terms" && r.samples[0].terms.x402Version).toBe(1);
  });

  it("probes POST endpoints with a fixture body", async () => {
    const r = await probe(`${seller.origin}/v2`, { method: "POST", body: '{"q":"test"}', samples: 1 });
    expect(r.samples[0]?.kind).toBe("terms");
  });

  it("reports an endpoint that answers 200 unpaid", async () => {
    expect((await probe(`${seller.origin}/free`, { samples: 1 })).samples[0]).toEqual({ kind: "not402", status: 200 });
  });

  it("never follows redirects and never prints the Location value", async () => {
    const away = (await probe(`${seller.origin}/away`, { samples: 1 })).samples[0];
    expect(away).toEqual({ kind: "not402", status: 302, detail: "redirect to another host, not followed" });
    const near = (await probe(`${seller.origin}/near`, { samples: 1 })).samples[0];
    expect(near).toEqual({ kind: "not402", status: 307, detail: "redirect on the same host, not followed" });
    expect((await probe(`${seller.origin}/noloc`, { samples: 1 })).samples[0]).toEqual({
      kind: "not402",
      status: 301,
      detail: "redirect without a target, not followed",
    });
    expect((await probe(`${seller.origin}/badloc`, { samples: 1 })).samples[0]).toEqual({
      kind: "not402",
      status: 302,
      detail: "redirect to an unreadable target, not followed",
    });
  });

  it("reports a garbage PAYMENT-REQUIRED header as unreadable", async () => {
    expect((await probe(`${seller.origin}/garbage`, { samples: 1 })).samples[0]?.kind).toBe("unreadable");
  });

  it("stops reading a body above the size limit", async () => {
    const r = await probe(`${seller.origin}/big`, { samples: 1, maxBodyBytes: 1024 });
    expect(r.samples[0]).toEqual({ kind: "unreadable", reason: "response body is larger than 1024 bytes" });
  });

  it("times out", async () => {
    expect((await probe(`${seller.origin}/slow`, { samples: 1, timeoutMs: 100 })).samples[0]).toEqual({
      kind: "timeout",
    });
  });

  it("reports a refused connection as no HTTP response", async () => {
    const port = await new Promise<number>((resolve) => {
      const s = createServer();
      s.listen(0, "127.0.0.1", () => {
        const addr = s.address();
        s.close(() => {
          resolve(typeof addr === "object" && addr !== null ? addr.port : 0);
        });
      });
    });
    const r = await probe(`http://127.0.0.1:${String(port)}/x`, { samples: 1 });
    expect(r.samples[0]).toMatchObject({ kind: "not402", status: 0 });
  });
});

describe("probe input checks (before any request)", () => {
  it.each(["http://api.example.com/x", "https://user:pw@a.example/x", "ftp://a.example/x"])(
    "refuses %s",
    async (url) => {
      await expect(probe(url)).rejects.toThrow(ProbeUrlError);
    },
  );

  it("refuses a sample count outside 1..5 and a body on GET", async () => {
    await expect(probe(`${seller.origin}/v2`, { samples: 0 })).rejects.toThrow(RangeError);
    await expect(probe(`${seller.origin}/v2`, { samples: 6 })).rejects.toThrow(RangeError);
    await expect(probe(`${seller.origin}/v2`, { body: "{}" })).rejects.toThrow(RangeError);
  });
});
