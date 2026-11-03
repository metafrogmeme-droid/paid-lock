import { emptyLock, endpointKey, newEndpoint, type Lock } from "@paid-lock/core";
import { parsePaymentRequired } from "@paid-lock/protocols";
import { describe, expect, it, vi } from "vitest";
import { installPaidLock, PaidLockHookError, paidLockX402Hooks } from "./x402-client.ts";

// Test fixture: fake payTo addresses; the asset is Base Sepolia (testnet) USDC from the x402 v2 spec.
const URL_ = "https://shop.example.com/v1/forecast";
const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PAY = "0x0000000000000000000000000000000000001001";
const OTHER_PAY = "0x000000000000000000000000000000000000dEaD";

const req = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  scheme: "exact",
  network: "eip155:84532",
  amount: "10000",
  asset: ASSET,
  payTo: PAY,
  maxTimeoutSeconds: 60,
  extra: { name: "USDC", version: "2" },
  ...over,
});
const pr = (r: Record<string, unknown> = req(), top: Record<string, unknown> = {}) => ({
  x402Version: 2,
  resource: { url: URL_ },
  accepts: [r],
  ...top,
});

function lock(): Lock {
  const parsed = parsePaymentRequired(pr());
  if (!parsed.ok) throw new Error(parsed.reason);
  const l = emptyLock();
  l.endpoints[endpointKey("GET", URL_)] = newEndpoint(parsed.terms, { toleranceBps: 0 });
  return l;
}

/** What the x402 HTTP client does: onPaymentRequired with the request URL, then the before-payment hook. */
async function flow(
  hooks: ReturnType<typeof paidLockX402Hooks>,
  paymentRequired: object,
  selected: object,
  url = URL_,
) {
  await hooks.onPaymentRequired({ paymentRequired, requestUrl: url });
  return hooks.onBeforePaymentCreation({ paymentRequired, selectedRequirements: selected });
}

describe("paidLockX402Hooks", () => {
  it("lets a payment for pinned terms go ahead (no abort)", async () => {
    const p = pr();
    await expect(flow(paidLockX402Hooks(lock()), p, req())).resolves.toBeUndefined();
  });

  it("aborts with the Blocked line when the seller changed payTo", async () => {
    const p = pr(req({ payTo: OTHER_PAY }));
    const r = await flow(paidLockX402Hooks(lock()), p, req({ payTo: OTHER_PAY }));
    expect(r).toMatchObject({ abort: true });
    expect(r?.reason.startsWith("Blocked by your rule: payTo changed since paid.lock")).toBe(true);
  });

  it("aborts when a client policy changed the selected option, even though the 402 matches the lock", async () => {
    const r = await flow(paidLockX402Hooks(lock()), pr(), req({ amount: "99999" }));
    expect(r?.reason.startsWith("Blocked by your rule: price is above the maximum in paid.lock")).toBe(true);
  });

  it("checks the URL the agent requested, not the URL the 402 claims (no confused deputy)", async () => {
    // An endpoint that is not pinned copies a pinned endpoint's terms, resource URL included.
    const r = await flow(paidLockX402Hooks(lock()), pr(), req(), "https://other.example.com/v1/forecast");
    expect(r?.reason).toBe("Blocked by your rule: endpoint is not in paid.lock");
  });

  it("re-checks at pay time: a change made to the 402 after onPaymentRequired is still caught", async () => {
    const hooks = paidLockX402Hooks(lock());
    const p = pr();
    await hooks.onPaymentRequired({ paymentRequired: p, requestUrl: URL_ });
    p.resource = { url: `${URL_}/other` };
    const r = await hooks.onBeforePaymentCreation({ paymentRequired: p, selectedRequirements: req() });
    expect(r?.reason.startsWith("Blocked by your rule: the 402 names a different resource URL")).toBe(true);
  });

  it("aborts on Needs your OK by default and lets it through only with failOn: blocked", async () => {
    const changed = req({ extra: { name: "USDC", version: "3" } });
    const strict = await flow(paidLockX402Hooks(lock()), pr(changed), changed);
    expect(strict?.reason.startsWith("Needs your OK: ")).toBe(true);
    const loose = await flow(paidLockX402Hooks(lock(), { failOn: "blocked" }), pr(changed), changed);
    expect(loose).toBeUndefined();
  });

  it("fails closed with a tool error when the 402 was never seen by onPaymentRequired", async () => {
    const hooks = paidLockX402Hooks(lock());
    await expect(hooks.onBeforePaymentCreation({ paymentRequired: pr(), selectedRequirements: req() })).rejects.toThrow(
      PaidLockHookError,
    );
    await expect(hooks.onBeforePaymentCreation({ paymentRequired: null, selectedRequirements: req() })).rejects.toThrow(
      PaidLockHookError,
    );
  });

  it("never asks the HTTP client to retry with headers", async () => {
    await expect(
      paidLockX402Hooks(lock()).onPaymentRequired({ paymentRequired: "x", requestUrl: URL_ }),
    ).resolves.toBeUndefined();
  });

  it("checks with the configured method", async () => {
    const r = await flow(paidLockX402Hooks(lock(), { method: "POST" }), pr(), req());
    expect(r?.reason).toBe("Blocked by your rule: endpoint is not in paid.lock");
  });

  it("reports every check to onCheck, with the URL", async () => {
    const seen: { url: string; code: string }[] = [];
    const onCheck = (e: { url: string; check: { code: string } }): void => {
      seen.push({ url: e.url, code: e.check.code });
    };
    await flow(paidLockX402Hooks(lock(), { onCheck }), pr(), req());
    expect(seen).toEqual([{ url: URL_, code: "OK" }]);
  });
});

describe("installPaidLock", () => {
  it("registers both hooks on the x402 client and the HTTP client", () => {
    const client = { onBeforePaymentCreation: vi.fn() };
    const http = { onPaymentRequired: vi.fn() };
    const hooks = installPaidLock({ client, http }, lock());
    expect(client.onBeforePaymentCreation).toHaveBeenCalledWith(hooks.onBeforePaymentCreation);
    expect(http.onPaymentRequired).toHaveBeenCalledWith(hooks.onPaymentRequired);
  });
});
