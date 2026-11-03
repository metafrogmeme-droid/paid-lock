// Written with AI help, test fixture.
// One MPP endpoint (/mpp) with two Payment challenges, plus the named changes the M5 acceptance check
// needs: recipient, currency and amount changes are caught; id, expires and opaque (fresh on every
// response) are ignored. Recipients are fake; currencies are an ISO 4217 code and a fake token address.
import { parseScenario, type Scenario } from "./scenario.ts";

export const MPP_RECIPIENT = "0x0000000000000000000000000000000000004004";
export const MPP_TOKEN = "0x0000000000000000000000000000000000000c0c";

export interface MppChange {
  recipient?: string;
  currency?: string;
  amount?: string;
  realm?: string;
  method?: string;
}

export function mppScenario(change: MppChange = {}): Scenario {
  return parseScenario({
    _label: "Written with AI help, test fixture. Fake recipients and token address.",
    name: "mpp",
    routes: [
      {
        method: "GET",
        path: "/mpp",
        respond: {
          kind: "mpp",
          challenges: [
            {
              realm: change.realm ?? "seller.test",
              method: change.method ?? "tempo",
              intent: "charge",
              request: {
                amount: change.amount ?? "1000000",
                currency: change.currency ?? MPP_TOKEN,
                recipient: change.recipient ?? MPP_RECIPIENT,
                methodDetails: { chainId: 4217 },
              },
            },
            {
              realm: "seller.test",
              method: "stripe",
              intent: "charge",
              request: { amount: "100", currency: "usd" },
            },
          ],
        },
      },
    ],
  });
}

/** Named changes and what paid.lock must answer (verdict, first reason code). */
export const MPP_VARIANTS: Readonly<Record<string, { change: MppChange; expect: [string, string] }>> = {
  unchanged: { change: {}, expect: ["allowed", "OK"] },
  "recipient-swapped": {
    change: { recipient: "0x000000000000000000000000000000000000dEaD" },
    expect: ["blocked", "PAYTO_CHANGED"],
  },
  "currency-swapped": { change: { currency: "usd" }, expect: ["blocked", "ASSET_CHANGED"] },
  "amount-x3": { change: { amount: "3000000" }, expect: ["blocked", "PRICE_ABOVE_LOCK"] },
  "amount-half": { change: { amount: "500000" }, expect: ["allowed", "OK"] },
  "method-swapped": { change: { method: "other" }, expect: ["blocked", "NETWORK_CHANGED"] },
  "realm-changed": { change: { realm: "other.test" }, expect: ["needsOk", "TERMS_CHANGED_OTHER"] },
};
