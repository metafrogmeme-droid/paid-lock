// Adapter for the official x402 TypeScript client (@x402/core, x402-foundation/x402 @ e208bd3:
// typescript/packages/core/src/client/x402Client.ts and src/http/x402HTTPClient.ts). Structural
// types only: this package does not depend on the x402 SDK, and it never pays, signs or loads a key.
//
// Two hooks, used together:
// - x402HTTPClient.onPaymentRequired({ paymentRequired, requestUrl }) records the URL the agent
//   requested. It is the only hook that sees the URL, and the URL must come from the request, not
//   from the seller's 402 (else a seller could point the check at another pinned endpoint).
// - x402Client.onBeforePaymentCreation({ paymentRequired, selectedRequirements }) runs right
//   before a payment is created. It checks the whole 402 and the selected option against the lock
//   at that moment and aborts with the verdict line unless the check allows the payment.
import type { Lock, Method } from "@paid-lock/core";
import { allows, checkAgainstLock, checkSelected, type FailOn, type LockCheck } from "../check.ts";

export interface PaymentRequiredContextLike {
  paymentRequired: unknown;
  requestUrl: string;
}

export interface PaymentCreationContextLike {
  paymentRequired: unknown;
  selectedRequirements: unknown;
}

export interface Abort {
  abort: true;
  /** One of the three verdict strings. */
  reason: string;
}

export interface PaidLockX402Options {
  /** HTTP method of the paid requests (the x402 hooks do not carry it). Default GET. */
  method?: Method;
  /** "needs-ok" (default): pay only on Allowed. "blocked": also pay on Needs your OK. */
  failOn?: FailOn;
  /** Called with every pay-time check, e.g. for logging. */
  onCheck?: (event: { url: string; check: LockCheck }) => void;
}

export interface PaidLockX402Hooks {
  onPaymentRequired: (context: PaymentRequiredContextLike) => Promise<void>;
  onBeforePaymentCreation: (context: PaymentCreationContextLike) => Promise<Abort | undefined>;
}

/** Thrown when the hooks are wired up wrongly. It stops the payment (fail closed). */
export class PaidLockHookError extends Error {
  override readonly name = "PaidLockHookError";
}

const RANK = { allowed: 0, needsOk: 1, blocked: 2 } as const;

function worse(a: LockCheck, b: LockCheck): LockCheck {
  return RANK[b.verdict] > RANK[a.verdict] ? b : a;
}

export function paidLockX402Hooks(lock: Lock, options: PaidLockX402Options = {}): PaidLockX402Hooks {
  const method = options.method ?? "GET";
  const failOn = options.failOn ?? "needs-ok";
  const urls = new WeakMap<object, string>();
  return {
    onPaymentRequired: (context) => {
      const { paymentRequired, requestUrl } = context;
      if (paymentRequired !== null && typeof paymentRequired === "object") urls.set(paymentRequired, requestUrl);
      return Promise.resolve();
    },
    onBeforePaymentCreation: (context) => {
      const { paymentRequired, selectedRequirements } = context;
      const url =
        paymentRequired !== null && typeof paymentRequired === "object" ? urls.get(paymentRequired) : undefined;
      if (url === undefined) {
        return Promise.reject(
          new PaidLockHookError(
            "paid.lock: this 402 was not seen by onPaymentRequired, so its URL is unknown. Register both hooks " +
              "(installPaidLock) and pass the same x402HTTPClient to the fetch wrapper.",
          ),
        );
      }
      const check = worse(
        checkAgainstLock(lock, method, url, paymentRequired),
        checkSelected(lock, method, url, paymentRequired, selectedRequirements),
      );
      options.onCheck?.({ url, check });
      return Promise.resolve(allows(check, failOn) ? undefined : { abort: true, reason: check.detail });
    },
  };
}

/** Register both hooks: `client` is the x402Client, `http` the x402HTTPClient that wraps it. */
export function installPaidLock(
  targets: {
    client: { onBeforePaymentCreation(hook: PaidLockX402Hooks["onBeforePaymentCreation"]): unknown };
    http: { onPaymentRequired(hook: PaidLockX402Hooks["onPaymentRequired"]): unknown };
  },
  lock: Lock,
  options: PaidLockX402Options = {},
): PaidLockX402Hooks {
  const hooks = paidLockX402Hooks(lock, options);
  targets.http.onPaymentRequired(hooks.onPaymentRequired);
  targets.client.onBeforePaymentCreation(hooks.onBeforePaymentCreation);
  return hooks;
}
