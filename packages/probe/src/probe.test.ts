import { parseScenario, startMockSeller, type MockSeller } from "@paid-lock/mock-seller";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_TIMEOUT_MS, probe, sendPinned, USER_AGENT } from "./probe.ts";
import { ProbeUrlError } from "./url-policy.ts";

const PAY = "0x0000000000000000000000000000000000001001";
const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const base = { scheme: "exact", asset: ASSET, payTo: PAY, maxTimeoutSeconds: 60 };
const accepts = [{ ...base, network: "eip155:84532", amount: "10000" }];
const acceptsV1 = [
  { ...base, network: "base-sepolia", maxAmountRequired: "10000", resource: "${origin}/v1", description: "" },
];

const scenario = parseScenario({
  _label: "Test fixture. Fake payTo; asset is Base Sepolia (testnet) USDC.",
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
    {
      method: "GET",
      path: "/mpp",
      respond: {
        kind: "mpp",
        challenges: [
          {
            realm: "seller.test",
            method: "example",
            intent: "charge",
            request: { amount: "1000", currency: "usd", recipient: "acct_1" },
          },
        ],
      },
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

/** The mock seller is on loopback, which the probe refuses unless the lock entry opts in. */
const LOCAL = { allowPrivateNetwork: true } as const;

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
    const r = await probe(`${seller.origin}/v2`, LOCAL);
    expect(r.samples.map((s) => s.kind)).toEqual(["terms", "terms"]);
    const stats = seller.stats();
    expect(stats.requests - before).toBe(2);
    expect(stats.paymentHeadersSeen).toBe(0);
    expect(stats.requestHeaderNames.filter((n) => !ALLOWED_HEADER_NAMES.has(n))).toEqual([]);
  });

  it("reads MPP challenges; their fresh id, expires and opaque leave the two samples identical", async () => {
    const r = await probe(`${seller.origin}/mpp`, LOCAL);
    const [a, b] = r.samples;
    expect(a?.kind === "terms" && a.terms.protocol).toBe("mpp");
    expect(a?.kind === "terms" && a.terms.resourceUrl).toBe(`${seller.origin}/mpp`);
    expect(b).toEqual(a);
  });

  it("reads x402 v1 bodies", async () => {
    const r = await probe(`${seller.origin}/v1`, { ...LOCAL, samples: 1 });
    expect(r.samples[0]?.kind === "terms" && r.samples[0].terms.x402Version).toBe(1);
  });

  it("probes POST endpoints with a fixture body", async () => {
    const r = await probe(`${seller.origin}/v2`, { ...LOCAL, method: "POST", body: '{"q":"test"}', samples: 1 });
    expect(r.samples[0]?.kind).toBe("terms");
  });

  it("reports an endpoint that answers 200 unpaid", async () => {
    expect((await probe(`${seller.origin}/free`, { ...LOCAL, samples: 1 })).samples[0]).toEqual({
      kind: "not402",
      status: 200,
    });
  });

  it("never follows redirects and never prints the Location value", async () => {
    const away = (await probe(`${seller.origin}/away`, { ...LOCAL, samples: 1 })).samples[0];
    expect(away).toEqual({ kind: "not402", status: 302, detail: "redirect to another host, not followed" });
    const near = (await probe(`${seller.origin}/near`, { ...LOCAL, samples: 1 })).samples[0];
    expect(near).toEqual({ kind: "not402", status: 307, detail: "redirect on the same host, not followed" });
    expect((await probe(`${seller.origin}/noloc`, { ...LOCAL, samples: 1 })).samples[0]).toEqual({
      kind: "not402",
      status: 301,
      detail: "redirect without a target, not followed",
    });
    expect((await probe(`${seller.origin}/badloc`, { ...LOCAL, samples: 1 })).samples[0]).toEqual({
      kind: "not402",
      status: 302,
      detail: "redirect to an unreadable target, not followed",
    });
  });

  it("reports a garbage PAYMENT-REQUIRED header as unreadable", async () => {
    expect((await probe(`${seller.origin}/garbage`, { ...LOCAL, samples: 1 })).samples[0]?.kind).toBe("unreadable");
  });

  it("stops reading a body above the size limit", async () => {
    const r = await probe(`${seller.origin}/big`, { ...LOCAL, samples: 1, maxBodyBytes: 1024 });
    expect(r.samples[0]).toEqual({ kind: "unreadable", reason: "response body is larger than 1024 bytes" });
  });

  it("times out", async () => {
    expect((await probe(`${seller.origin}/slow`, { ...LOCAL, samples: 1, timeoutMs: 100 })).samples[0]).toEqual({
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
    const r = await probe(`http://127.0.0.1:${String(port)}/x`, { ...LOCAL, samples: 1 });
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

describe("address policy (owner decision, 2 Nov 2026)", () => {
  it("refuses the loopback mock seller without the opt-in, before any request", async () => {
    const before = seller.stats().requests;
    await expect(probe(`${seller.origin}/v2`)).rejects.toThrow(/loopback address; refused before any request/);
    expect(seller.stats().requests).toBe(before);
  });

  it.each([
    ["IPv4 private", "https://10.0.0.1/x"],
    ["IPv4 link-local (cloud metadata)", "https://169.254.169.254/latest/meta-data"],
    ["IPv4 written in hex", "https://0x7f000001/x"],
    ["IPv4 written as one number", "https://2130706433/x"],
    ["IPv6 loopback", "http://[::1]:4021/x"],
    ["IPv6 link-local", "https://[fe80::1]/x"],
    ["IPv6 unique local", "https://[fd00::1]/x"],
    ["IPv4-mapped IPv6", "https://[::ffff:192.168.0.1]/x"],
  ])("refuses a literal %s address without touching DNS", async (_name, url) => {
    const resolve = vi.fn(() => Promise.resolve([]));
    await expect(probe(url, { resolve, samples: 1 })).rejects.toThrow(/refused before any request/);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("uses the system resolver by default: localhost resolves to loopback and is refused", async () => {
    await expect(probe("https://localhost/x", { samples: 1 })).rejects.toThrow(
      /loopback address; refused before any request/,
    );
  });

  it("treats duplicate PAYMENT-REQUIRED headers as unreadable (Node joins them)", async () => {
    seller.use(
      parseScenario({
        _label: "Test fixture.",
        name: "dup",
        routes: [
          {
            method: "GET",
            path: "/dup",
            respond: { kind: "raw", status: 402, headers: { "PAYMENT-REQUIRED": "e30=" } },
          },
        ],
      }),
    );
    const r = await probe(`${seller.origin}/dup`, { ...LOCAL, samples: 1 });
    expect(r.samples[0]?.kind).toBe("unreadable");
    seller.use(scenario);
  });

  it("refuses a DNS name that resolves to a private address", async () => {
    const resolve = () => Promise.resolve([{ address: "10.1.2.3", family: 4 as const }]);
    await expect(probe("https://seller.example/x", { resolve, samples: 1 })).rejects.toThrow(
      /resolves to a private address/,
    );
  });

  it("refuses a DNS name when any one of its answers is private (mixed records)", async () => {
    const resolve = () =>
      Promise.resolve([
        { address: "93.184.216.34", family: 4 as const },
        { address: "fe80::1", family: 6 as const },
      ]);
    await expect(probe("https://seller.example/x", { resolve, samples: 1 })).rejects.toThrow(/link-local/);
  });

  it("reports a name that does not resolve as a refusal", async () => {
    const resolve = () => Promise.reject(Object.assign(new Error("nope"), { code: "ENOTFOUND" }));
    await expect(probe("https://seller.example/x", { resolve, samples: 1 })).rejects.toThrow(
      /could not be resolved \(ENOTFOUND\)/,
    );
  });

  it("DNS rebinding: resolves once per request and connects to exactly the checked address", async () => {
    // The resolver answers loopback first and an attacker-chosen address afterwards. The probe must
    // never ask twice for one request, so the later answer can never be used.
    const answers = ["127.0.0.1", "10.66.66.66"];
    const resolve = vi.fn(() => Promise.resolve([{ address: answers.shift() ?? "10.66.66.66", family: 4 as const }]));
    const port = new URL(seller.origin).port;
    const r = await probe(`http://localhost:${port}/v2`, { ...LOCAL, resolve, samples: 1 });
    expect(r.samples[0]?.kind).toBe("terms");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("DNS rebinding: the connection uses the pinned address and never looks the name up again", async () => {
    // "rebind.invalid" cannot resolve anywhere (RFC 6761), so reaching the mock seller proves the
    // socket went to the pinned address without a second DNS query.
    const port = new URL(seller.origin).port;
    const res = await sendPinned(
      new URL(`http://rebind.invalid:${port}/v2`),
      { address: "127.0.0.1", family: 4 },
      {
        method: "GET",
        timeoutMs: DEFAULT_TIMEOUT_MS,
        maxBodyBytes: 1024,
        allowPrivateNetwork: true,
        resolve: () => Promise.reject(new Error("must not be called")),
      },
    );
    expect(res.statusCode).toBe(402);
    res.destroy();
  });

  it("identifies itself honestly", () => {
    expect(USER_AGENT).toContain("never pays");
  });
});
