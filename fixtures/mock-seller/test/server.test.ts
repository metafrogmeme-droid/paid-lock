// Written with AI help, test fixture.
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
    expect(s.stats()).toEqual({ requests: 1, paymentHeadersSeen: 0, challengesServed: 1 });
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
    expect(stats).toEqual({ requests: 2, paymentHeadersSeen: 0, challengesServed: 1 });
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

  it("rejects a scenario without the AI-help label or with unknown keys", () => {
    expect(() => parseScenario({ name: "x", routes: [] })).toThrow();
    expect(() => parseScenario({ _label: "Written with AI help", name: "x", routes: [], extra: true })).toThrow();
  });
});
