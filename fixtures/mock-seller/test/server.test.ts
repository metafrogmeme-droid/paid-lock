// Test fixture.
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeTerms } from "@paid-lock/core";
import { observe402 } from "@paid-lock/protocols";
import { loadScenario, parseScenario, startMockSeller, type MockSeller } from "../src/index.ts";

/** Some containers have no IPv6 loopback; GitHub-hosted runners do. */
const HAS_IPV6_LOOPBACK = Object.values(networkInterfaces()).some((list) =>
  (list ?? []).some((i) => i.internal && i.address === "::1"),
);

const BASELINE = fileURLToPath(new URL("../scenarios/baseline.json", import.meta.url));

let seller: MockSeller | undefined;
afterEach(async () => {
  await seller?.close();
  seller = undefined;
});

async function start(): Promise<MockSeller> {
  seller = await startMockSeller({ scenario: await loadScenario(BASELINE) });
  return seller;
}

describe("mock seller", () => {
  it("answers 402 with a valid Base64 PAYMENT-REQUIRED header on loopback", async () => {
    const s = await start();
    expect(s.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await fetch(`${s.origin}/v1/forecast`);
    expect(res.status).toBe(402);
    const obs = observe402({
      status: res.status,
      headers: { "payment-required": res.headers.get("payment-required") ?? undefined },
      body: await res.text(),
    });
    if (obs.kind !== "terms") throw new Error(`expected readable terms, got ${obs.kind}`);
    const n = normalizeTerms(obs.terms);
    expect(n.ok).toBe(true);
    expect(obs.terms.resourceUrl).toBe(`${s.origin}/v1/forecast`);
    expect(obs.terms.options[0]?.network).toBe("eip155:84532");
    expect(s.stats()).toMatchObject({ requests: 1, paymentHeadersSeen: 0, challengesServed: 1 });
    expect(s.stats().requestHeaderNames).toContain("host");
  });

  it("answers 404 for an unknown route and for the wrong method", async () => {
    const s = await start();
    expect((await fetch(`${s.origin}/nope`)).status).toBe(404);
    expect((await fetch(`${s.origin}/v1/forecast`, { method: "POST" })).status).toBe(404);
  });

  it.each([
    ["PAYMENT-SIGNATURE", "test-not-a-payment"],
    ["X-PAYMENT", "test-not-a-payment"],
    ["Authorization", "Payment test-not-a-payment"],
  ])("counts and rejects a request carrying %s", async (name, value) => {
    const s = await start();
    const res = await fetch(`${s.origin}/v1/forecast`, { headers: { [name]: value } });
    expect(res.status).toBe(400);
    expect(s.stats().paymentHeadersSeen).toBe(1);
    expect(s.stats().challengesServed).toBe(0);
  });

  it("does not count an ordinary Authorization header as a payment", async () => {
    const s = await start();
    await fetch(`${s.origin}/v1/forecast`, { headers: { Authorization: "Bearer test" } });
    expect(s.stats().paymentHeadersSeen).toBe(0);
  });

  it("reports its stats on /__mock/stats", async () => {
    const s = await start();
    await fetch(`${s.origin}/v1/forecast`);
    const stats: unknown = await (await fetch(`${s.origin}/__mock/stats`)).json();
    expect(stats).toMatchObject({ requests: 2, paymentHeadersSeen: 0, challengesServed: 1 });
  });

  it.runIf(HAS_IPV6_LOOPBACK)("binds to IPv6 loopback too", async () => {
    seller = await startMockSeller({ scenario: await loadScenario(BASELINE), host: "::1" });
    expect(seller.origin).toMatch(/^http:\/\/\[::1\]:\d+$/);
    expect((await fetch(`${seller.origin}/v1/forecast`)).status).toBe(402);
  });

  it("refuses to bind to a non-loopback address", async () => {
    const scenario = await loadScenario(BASELINE);
    // @ts-expect-error: the type allows loopback only; this checks the runtime guard too.
    await expect(startMockSeller({ scenario, host: "0.0.0.0" })).rejects.toThrow(/loopback only/);
  });

  it("rejects a scenario without the test-fixture label or with unknown keys", () => {
    expect(() => parseScenario({ name: "x", routes: [] })).toThrow();
    expect(() => parseScenario({ _label: "a scenario", name: "x", routes: [] })).toThrow();
    expect(() => parseScenario({ _label: "Test fixture.", name: "x", routes: [], extra: true })).toThrow();
  });

  it("serves x402 v1 bodies, raw answers and delays, and can switch scenarios", async () => {
    const s = await start();
    s.use(
      parseScenario({
        _label: "Test fixture.",
        name: "kinds",
        routes: [
          { method: "GET", path: "/v1", respond: { kind: "x402-v1", body: { x402Version: 1, url: "${origin}/v1" } } },
          { method: "GET", path: "/free", respond: { kind: "raw", status: 200, body: "free" } },
          {
            method: "GET",
            path: "/moved",
            respond: { kind: "raw", status: 302, headers: { location: "https://other.example/x" } },
          },
          { method: "GET", path: "/big", respond: { kind: "raw", status: 402, bodyBytes: 2048 } },
          { method: "GET", path: "/slow", delayMs: 50, respond: { kind: "raw", status: 200 } },
        ],
      }),
    );
    const v1 = await fetch(`${s.origin}/v1`);
    expect(v1.status).toBe(402);
    expect(await v1.json()).toEqual({ x402Version: 1, url: `${s.origin}/v1` });
    expect(await (await fetch(`${s.origin}/free`)).text()).toBe("free");
    const moved = await fetch(`${s.origin}/moved`, { redirect: "manual" });
    expect(moved.status).toBe(302);
    expect(moved.headers.get("location")).toBe("https://other.example/x");
    expect((await (await fetch(`${s.origin}/big`)).text()).length).toBe(2048);
    const t0 = Date.now();
    await fetch(`${s.origin}/slow`);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
    expect(s.stats().challengesServed).toBe(1);
    expect((await fetch(`${s.origin}/v1/forecast`)).status).toBe(404);
  });
});

describe("mock seller: MPP challenges (test fixture)", () => {
  const mpp = parseScenario({
    _label: "Test fixture. Fake recipients; currency is an ISO 4217 code.",
    name: "mpp",
    routes: [
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
              request: { recipient: "acct_1", currency: "usd", amount: "1000" },
            },
            { realm: "seller.test", method: "other", intent: "charge", request: { amount: "5", currency: "usd" } },
          ],
        },
      },
    ],
  });

  it("answers 402 with one WWW-Authenticate line per challenge, fresh id, expires and opaque each time", async () => {
    seller = await startMockSeller({ scenario: mpp });
    const first = await fetch(`${seller.origin}/mpp`);
    const second = await fetch(`${seller.origin}/mpp`);
    expect(first.status).toBe(402);
    const a = first.headers.get("www-authenticate") ?? "";
    const b = second.headers.get("www-authenticate") ?? "";
    expect(a.match(/Payment /gu)).toHaveLength(2);
    const ids = (h: string) => [...h.matchAll(/ id="([^"]+)"/gu)].map((m) => m[1]);
    expect(ids(a)).toHaveLength(2);
    expect(ids(a)).not.toEqual(ids(b));
    expect(a).toMatch(/expires="\d{4}-\d\d-\d\dT[^"]+Z"/u);
    expect(a).toMatch(/opaque="[A-Za-z0-9_-]+"/u);
  });

  it("serialises the request with sorted keys and no padding (JCS for the fixture's strings)", async () => {
    seller = await startMockSeller({ scenario: mpp });
    const h = (await fetch(`${seller.origin}/mpp`)).headers.get("www-authenticate") ?? "";
    const request = /request="([^"]+)"/u.exec(h)?.[1] ?? "";
    expect(request).not.toContain("=");
    expect(Buffer.from(request, "base64url").toString("utf8")).toBe(
      '{"amount":"1000","currency":"usd","recipient":"acct_1"}',
    );
    expect(seller.stats().challengesServed).toBe(1);
  });
});
