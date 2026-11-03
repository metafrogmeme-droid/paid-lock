// Written with AI help, test fixture. Fake payTo addresses; the asset is Base Sepolia (testnet) USDC
// from the x402 v2 spec example. Not built or shipped (excluded in tsconfig and coverage).
import type { ObservedTerms, PaymentOption } from "../terms.ts";

export const USDC_TESTNET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const PAY_A = "0x0000000000000000000000000000000000001001";

export function option(over: Partial<PaymentOption> = {}): PaymentOption {
  return {
    scheme: "exact",
    network: "eip155:84532",
    asset: USDC_TESTNET,
    payTo: PAY_A,
    amount: "10000",
    maxTimeoutSeconds: 60,
    paymentFlow: "authorization",
    assetTransferMethod: null,
    extra: { name: "USDC", version: "2" },
    otherFields: {},
    ...over,
  };
}

export function terms(over: Partial<ObservedTerms> = {}): ObservedTerms {
  return {
    protocol: "x402",
    x402Version: 2,
    resourceUrl: "https://api.example.com/v1/forecast",
    options: [option()],
    envelope: {},
    ...over,
  };
}

/** MPP terms as the MPP parser builds them (DECISIONS D-027): one option per Payment challenge. */
export function mppTerms(over: Partial<ObservedTerms> = {}): ObservedTerms {
  return {
    protocol: "mpp",
    resourceUrl: "https://api.example.com/v1/forecast",
    options: [
      option({
        scheme: "charge",
        network: "mpp:tempo",
        asset: "0x20c0000000000000000000000000000000000000",
        payTo: PAY_A,
        amount: "1000000",
        maxTimeoutSeconds: 0,
        extra: { realm: "api.example.com", methodDetails: { chainId: 4217 } },
      }),
    ],
    envelope: {},
    ...over,
  };
}
