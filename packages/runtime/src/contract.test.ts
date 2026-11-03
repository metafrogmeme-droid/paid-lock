// Contract test (CLAUDE.md §6, M5): the runtime library gives the same verdicts as the CLI on the
// shared fixture set, the named /forecast changes that `pnpm demo` and the Action self-test use.
// Loopback mock seller only; it fails the run if it ever sees a payment header.
import { emptyLock, endpointKey, newEndpoint, type Lock } from "@paid-lock/core";
import { probe } from "@paid-lock/probe";
import { checkAgainstLock, checkResponse } from "./check.ts";
import { runVerify } from "paid-lock";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  demoScenario,
  FORECAST_VARIANTS,
  MPP_VARIANTS,
  mppScenario,
  startMockSeller,
  type MockSeller,
} from "@paid-lock/mock-seller";

const EXPECTED: Record<string, [verdict: string, code: string]> = {
  unchanged: ["allowed", "OK"],
  "payto-swapped": ["blocked", "PAYTO_CHANGED"],
  "network-swapped": ["blocked", "NETWORK_CHANGED"],
  "price-x3": ["blocked", "PRICE_ABOVE_LOCK"],
  "price-half": ["allowed", "OK"],
  "extra-version": ["needsOk", "TERMS_CHANGED_OTHER"],
  "unpaid-200": ["needsOk", "ENDPOINT_NOT_402"],
  "garbage-header": ["blocked", "REQUIREMENTS_UNREADABLE"],
};

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

async function unpaidResponse(): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const res = await fetch(url, { redirect: "manual" });
  return { status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() };
}

describe("runtime and CLI give the same verdicts on the shared fixture set", () => {
  it("covers every named variant", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(FORECAST_VARIANTS).sort());
  });

  it.each(Object.keys(FORECAST_VARIANTS))("%s", async (variant) => {
    const change = FORECAST_VARIANTS[variant];
    seller.use(demoScenario(change === undefined ? {} : { forecast: change }));

    const cli = (await runVerify(lock, { target: url, failOn: "needs-ok" })).results[0];
    const raw = await unpaidResponse();
    const runtime = checkResponse(lock, "GET", url, raw);

    const codes = (fs: readonly { code: string }[]) => fs.map((f) => f.code).sort();
    expect(cli).toBeDefined();
    expect([runtime.verdict, runtime.code]).toEqual(EXPECTED[variant]);
    expect(runtime.verdict).toBe(cli?.verdict);
    expect(runtime.detail).toBe(cli?.line);
    expect(codes(runtime.findings)).toEqual(codes(cli?.findings ?? []));
    expect(runtime.notes).toEqual(cli?.notes);

    // A client hook gets the PaymentRequired already decoded: same verdict from the object form.
    const headerValue = raw.headers["payment-required"];
    if (raw.status === 402 && headerValue !== undefined && variant !== "garbage-header") {
      const decoded: unknown = JSON.parse(Buffer.from(headerValue, "base64").toString("utf8"));
      const fromObject = checkAgainstLock(lock, "GET", url, decoded);
      expect([fromObject.verdict, fromObject.code, fromObject.detail]).toEqual([
        runtime.verdict,
        runtime.code,
        runtime.detail,
      ]);
    }
  });
});

describe("runtime and CLI give the same verdicts on the MPP fixture set (D-027)", () => {
  let mppSeller: MockSeller;
  let mppUrl: string;
  let mppLock: Lock;

  beforeAll(async () => {
    mppSeller = await startMockSeller({ scenario: mppScenario() });
    mppUrl = `${mppSeller.origin}/mpp`;
    const { samples } = await probe(mppUrl, { method: "GET", allowPrivateNetwork: true });
    const first = samples[0];
    if (first?.kind !== "terms") throw new Error("mock seller did not serve MPP terms");
    mppLock = emptyLock();
    mppLock.endpoints[endpointKey("GET", mppUrl)] = newEndpoint(first.terms, {
      toleranceBps: 0,
      allowPrivateNetwork: true,
    });
  });

  afterAll(async () => {
    const stats = mppSeller.stats();
    await mppSeller.close();
    expect(stats.paymentHeadersSeen).toBe(0);
  });

  it.each(Object.keys(MPP_VARIANTS))("%s", async (name) => {
    const variant = MPP_VARIANTS[name];
    if (variant === undefined) throw new Error(name);
    mppSeller.use(mppScenario(variant.change));
    const cli = (await runVerify(mppLock, { target: mppUrl, failOn: "needs-ok" })).results[0];
    const res = await fetch(mppUrl, { redirect: "manual" });
    const runtime = checkResponse(mppLock, "GET", mppUrl, {
      status: res.status,
      headers: Object.fromEntries(res.headers),
      body: await res.text(),
    });
    expect([runtime.verdict, runtime.code]).toEqual(variant.expect);
    expect(runtime.verdict).toBe(cli?.verdict);
    expect(runtime.detail).toBe(cli?.line);
    expect(runtime.findings.map((f) => f.code).sort()).toEqual((cli?.findings ?? []).map((f) => f.code).sort());
  });
});
