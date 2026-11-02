// Written with AI help.
// Pay-time check against paid.lock (CLAUDE.md §3 item 9). No I/O: the lock is passed in (see
// load.ts) and the 402 comes from the client that is about to pay. It reads payment terms only; it
// never pays, signs or loads a key. Same core verify as the CLI and the Action, so a 402 gets the
// same verdict in CI and at pay time (contract.test.ts).
import {
  endpointKey,
  notInLock,
  verifyEndpoint,
  type EndpointResult,
  type Finding,
  type Lock,
  type Method,
  type Observation,
  type ReasonCode,
  type Verdict,
} from "@paid-lock/core";
import { observe402, parsePaymentRequired, type UnpaidResponse } from "@paid-lock/protocols";

export interface LockCheck {
  verdict: Verdict;
  /** The reason behind the verdict: the first finding with the worst verdict, or OK. */
  code: ReasonCode;
  /** One line, always one of the three verdict strings. Fit to show to the user as is. */
  detail: string;
  findings: readonly Finding[];
  /** Information that changes no verdict, e.g. a price drop. */
  notes: readonly string[];
}

/** Lock key for a request, or undefined when it cannot be in the lock (method or URL unreadable). */
function keyOf(method: string, url: string): string | undefined {
  const m = method.toUpperCase();
  if (m !== "GET" && m !== "POST") return undefined;
  try {
    return endpointKey(m satisfies Method, url);
  } catch {
    return undefined;
  }
}

function toCheck(r: EndpointResult): LockCheck {
  const reason = r.findings.find((f) => f.verdict === r.verdict);
  return { verdict: r.verdict, code: reason?.code ?? "OK", detail: r.line, findings: r.findings, notes: r.notes };
}

function check(lock: Lock, method: string, url: string, observe: () => Observation): LockCheck {
  const key = keyOf(method, url);
  if (key === undefined || !Object.hasOwn(lock.endpoints, key)) return toCheck(notInLock(`${method} ${url}`));
  return toCheck(verifyEndpoint(lock, key, observe()));
}

/**
 * Check a PaymentRequired that the client already decoded (x402 v2 header object or x402 v1 body)
 * for the request `method url`. Never throws; anything unreadable is Blocked.
 */
export function checkAgainstLock(lock: Lock, method: string, url: string, paymentRequired: unknown): LockCheck {
  return check(lock, method, url, () => {
    const parsed = parsePaymentRequired(paymentRequired);
    return parsed.ok ? { kind: "terms", terms: parsed.terms } : { kind: "unreadable", reason: parsed.reason };
  });
}

/** Check a raw unpaid HTTP response (status, headers in any case, body text). Never throws. */
export function checkResponse(
  lock: Lock,
  method: string,
  url: string,
  response: { status: number; headers: Readonly<Record<string, string | undefined>>; body: string },
): LockCheck {
  return check(lock, method, url, () => {
    const headers: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(response.headers)) headers[name.toLowerCase()] = value;
    const res: UnpaidResponse = { status: response.status, headers, body: response.body };
    return observe402(res);
  });
}
