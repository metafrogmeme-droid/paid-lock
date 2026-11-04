// The adapter wired into the official x402 TypeScript client (@x402/core 2.29.0, dev dependency only),
// against the loopback mock seller. The client gets a stub scheme that never signs: it only counts
// that the client reached the point where a real scheme would create a payment, and then stops the
// run. No payment is ever created or sent; the mock seller fails the run if it sees a payment header.
import { emptyLock, endpointKey, newEndpoint, type Lock } from "@paid-lock/core";
import { DEMO_ASSET, demoScenario, FORECAST_VARIANTS, startMockSeller, type MockSeller } from "@paid-lock/mock-seller";
import { probe } from "@paid-lock/probe";
import { x402Client, x402HTTPClient, type PaymentPolicy } from "@x402/core/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installPaidLock } from "./x402-client.ts";

const STOP = "stub scheme: the test stops here, before any payment is created";

let seller: MockSeller;
let url: string;
let lock: Lock;

beforeAll(async () => {
  seller = await startMockSeller({ scenario: demoScenario() });
  url = `${seller.origin}/forecast`;
  const { samples } = await probe(url, { method: "GET", allowPrivateNetwork: true });
  const first = samples[0];
  if (first?.kind !== "terms") throw new Error("mock seller did not serve terms");
  lock = emptyLock();
  lock.endpoints[endpointKey("GET", url)] = newEndpoint(first.terms, { toleranceBps: 0, allowPrivateNetwork: true });
});

afterAll(async () => {
  const stats = seller.stats();
  await seller.close();
  expect(stats.paymentHeadersSeen).toBe(0);
});

/** The steps of @x402/fetch's wrapFetchWithPayment up to payment creation, with an unpaid first request. */
type Wiring = "paid.lock" | "none" | "other HTTP client";

interface Attempt {
  wiring?: Wiring;
  /** The URL the agent requests; default the pinned /forecast. */
  target?: string;
  /** A client policy that filters or rewrites the requirements before one is selected (T25). */
  policy?: PaymentPolicy;
}

async function attemptPayment(attempt: Attempt = {}): Promise<{ schemeCalls: number; error: string }> {
  const { wiring = "paid.lock", target = url, policy } = attempt;
  let schemeCalls = 0;
  const stub = {
    scheme: "exact",
    createPaymentPayload: () => {
      schemeCalls += 1;
      return Promise.reject(new Error(STOP));
    },
  };
  // The SDK's own spend controls stay on; the testnet asset is allowed explicitly, as an agent would.
  const networks = ["eip155:84532", "eip155:8453"] as const;
  const client = x402Client.fromConfig({
    schemes: networks.map((network) => ({ network, client: stub })),
    ...(policy === undefined ? {} : { policies: [policy] }),
    spendControls: { allowedAssets: networks.map((network) => ({ network, asset: DEMO_ASSET })) },
  });
  const http = new x402HTTPClient(client);
  if (wiring === "paid.lock") installPaidLock({ client, http }, lock);
  // A wiring mistake (T24): the hooks are installed with another HTTP client than the one that reads the 402.
  if (wiring === "other HTTP client") installPaidLock({ client, http: new x402HTTPClient(client) }, lock);

  const res = await fetch(target, { redirect: "manual" });
  const text = await res.text();
  const body: unknown = text === "" ? undefined : JSON.parse(text);
  try {
    const paymentRequired = http.getPaymentRequiredResponse((name) => res.headers.get(name), body);
    await http.handlePaymentRequired(paymentRequired, res.url);
    await client.createPaymentPayload(paymentRequired);
    return { schemeCalls, error: "" };
  } catch (e) {
    return { schemeCalls, error: e instanceof Error ? e.message : String(e) };
  }
}

const CASES: Record<string, "reaches the scheme" | `aborted: ${string}`> = {
  unchanged: "reaches the scheme",
  "price-half": "reaches the scheme",
  "payto-swapped": "aborted: Blocked by your rule: payTo changed since paid.lock",
  "network-swapped": "aborted: Blocked by your rule: network changed since paid.lock",
  "price-x3": "aborted: Blocked by your rule: price is above the maximum in paid.lock",
  "extra-version": "aborted: Needs your OK: other payment terms changed since paid.lock",
};

describe("paid.lock hooks inside the official x402 client", () => {
  it.each(Object.keys(CASES))("%s", async (variant) => {
    const change = FORECAST_VARIANTS[variant];
    seller.use(demoScenario(change === undefined ? {} : { forecast: change }));
    const r = await attemptPayment();
    const expected = CASES[variant] ?? "";
    if (expected === "reaches the scheme") {
      expect(r).toEqual({ schemeCalls: 1, error: STOP });
    } else {
      expect(r.schemeCalls).toBe(0);
      expect(r.error.startsWith(`Payment creation aborted: ${expected.slice("aborted: ".length)}`)).toBe(true);
    }
  });

  it("control: without the paid.lock hooks, the same payTo change does reach the scheme", async () => {
    seller.use(demoScenario({ forecast: FORECAST_VARIANTS["payto-swapped"] ?? {} }));
    expect(await attemptPayment({ wiring: "none" })).toEqual({ schemeCalls: 1, error: STOP });
  });

  it("wired with another HTTP client, the payment stops instead of skipping the check (T24)", async () => {
    seller.use(demoScenario());
    const r = await attemptPayment({ wiring: "other HTTP client" });
    expect(r.schemeCalls).toBe(0);
    expect(r.error).toContain("paid.lock: this 402 was not seen by onPaymentRequired");
  });

  it("an unpinned URL serving a copy of the pinned 402 is blocked, whatever resource.url it names (T23)", async () => {
    const scenario = demoScenario();
    const pinned = scenario.routes.find((route) => route.path === "/forecast");
    if (pinned === undefined) throw new Error("demo scenario has no /forecast");
    seller.use({ ...scenario, routes: [...scenario.routes, { ...pinned, path: "/copycat" }] });
    const r = await attemptPayment({ target: `${seller.origin}/copycat` });
    expect(r.schemeCalls).toBe(0);
    expect(r.error.startsWith("Payment creation aborted: Blocked by your rule: ")).toBe(true);
    expect(r.error).toContain("not in paid.lock");
  });

  it("a client policy that rewrites payTo after the 402 was read is blocked at payment creation (T25)", async () => {
    seller.use(demoScenario());
    const rewrite: PaymentPolicy = (_version, reqs) =>
      reqs.map((req) => ({ ...req, payTo: "0x000000000000000000000000000000000000dEaD" }));
    const r = await attemptPayment({ policy: rewrite });
    expect(r.schemeCalls).toBe(0);
    expect(r.error.startsWith("Payment creation aborted: Blocked by your rule: payTo changed since paid.lock")).toBe(
      true,
    );
  });

  it("a garbage PAYMENT-REQUIRED header never reaches the scheme", async () => {
    seller.use(demoScenario({ forecast: FORECAST_VARIANTS["garbage-header"] ?? {} }));
    expect((await attemptPayment()).schemeCalls).toBe(0);
  });
});
