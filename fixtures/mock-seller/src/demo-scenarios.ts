// Test fixture.
// The three-endpoint seller used by `pnpm demo` and the Action self-test in CI, plus the named
// changes both of them flip. payTo values are fake test addresses; the asset is Base Sepolia
// (testnet) USDC from the x402 v2 spec example.
import { parseScenario, type Scenario } from "./scenario.ts";

export const DEMO_ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const DEMO_PAY = {
  forecast: "0x0000000000000000000000000000000000001001",
  quote: "0x0000000000000000000000000000000000002002",
  news: "0x0000000000000000000000000000000000003003",
} as const;
export const DEMO_AMOUNT = { forecast: "10000", quote: "25000", news: "5000" } as const;
export const SWAPPED_PAY_TO = "0x000000000000000000000000000000000000dead";

export type DemoEndpoint = keyof typeof DEMO_PAY;
export interface DemoChange {
  payTo?: string;
  network?: string;
  amount?: string;
  version?: string;
  raw?: { status: number; headers?: Record<string, string> };
}

export function demoScenario(changes: Partial<Record<DemoEndpoint, DemoChange>> = {}): Scenario {
  const route = (name: DemoEndpoint) => {
    const c = changes[name] ?? {};
    if (c.raw !== undefined)
      return { method: "GET" as const, path: `/${name}`, respond: { kind: "raw" as const, ...c.raw } };
    return {
      method: "GET" as const,
      path: `/${name}`,
      respond: {
        kind: "x402-v2" as const,
        paymentRequired: {
          x402Version: 2,
          resource: { url: `\${origin}/${name}` },
          accepts: [
            {
              scheme: "exact",
              network: c.network ?? "eip155:84532",
              amount: c.amount ?? DEMO_AMOUNT[name],
              asset: DEMO_ASSET,
              payTo: c.payTo ?? DEMO_PAY[name],
              maxTimeoutSeconds: 60,
              extra: { name: "USDC", version: c.version ?? "2" },
            },
          ],
        },
      },
    };
  };
  return parseScenario({
    _label: "Test fixture. payTo values are fake test addresses; the asset is Base Sepolia (testnet) USDC.",
    name: "demo",
    routes: [route("forecast"), route("quote"), route("news")],
  });
}

/** Named single-endpoint changes (on /forecast), as used by the Action self-test matrix in CI. */
export const FORECAST_VARIANTS: Readonly<Record<string, DemoChange | undefined>> = {
  unchanged: undefined,
  "payto-swapped": { payTo: SWAPPED_PAY_TO },
  "network-swapped": { network: "eip155:8453" },
  "price-x3": { amount: "30000" },
  "price-half": { amount: "5000" },
  "extra-version": { version: "3" },
  "unpaid-200": { raw: { status: 200 } },
  "garbage-header": { raw: { status: 402, headers: { "PAYMENT-REQUIRED": "not*base64*at*all" } } },
};
