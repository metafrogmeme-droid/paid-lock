// The verify run shared by the CLI and the GitHub Action, so both give identical results.
import {
  endpointKey,
  notInLock,
  summarize,
  verifySamples,
  type EndpointResult,
  type Lock,
  type Method,
  type ObservedTerms,
  type Summary,
} from "@paid-lock/core";
import { probe } from "@paid-lock/probe";

/** Exit codes (docs/SPEC.md): allowed 0, blocked 1, needs your OK 2, tool error 3. */
export const EXIT = { allowed: 0, blocked: 1, needsOk: 2, toolError: 3 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export type FailOn = "needs-ok" | "blocked";

export function isFailOn(value: string): value is FailOn {
  return value === "needs-ok" || value === "blocked";
}

export function methodOf(key: string): Method {
  return key.startsWith("POST ") ? "POST" : "GET";
}

export function urlOf(key: string): string {
  return key.slice(key.indexOf(" ") + 1);
}

/** Probe one endpoint (never one that is not pinned) and verify it against the lock. */
export async function checkEndpoint(
  lock: Lock,
  method: Method,
  url: string,
): Promise<{ key: string; result: EndpointResult; terms?: ObservedTerms }> {
  const key = endpointKey(method, url);
  // An endpoint that is not pinned is never probed: it is Blocked as NOT_IN_LOCK right away.
  if (!Object.hasOwn(lock.endpoints, key)) return { key, result: notInLock(key) };
  const allowPrivateNetwork = lock.endpoints[key]?.policy.allowPrivateNetwork === true;
  const { samples } = await probe(url, { method, allowPrivateNetwork });
  const result = verifySamples(lock, key, samples);
  const first = samples[0];
  return first?.kind === "terms" ? { key, result, terms: first.terms } : { key, result };
}

export function exitCodeFor(summary: Summary, failOn: FailOn): ExitCode {
  if (summary.verdict === "needsOk" && failOn === "blocked") return EXIT.allowed;
  return EXIT[summary.verdict];
}

export interface VerifyRun {
  results: EndpointResult[];
  summary: Summary;
  exitCode: ExitCode;
}

/** Verify every pinned endpoint (or one URL) and compute the exit code for `failOn`. */
export async function runVerify(lock: Lock, opts: { target?: string; failOn: FailOn }): Promise<VerifyRun> {
  const keys = opts.target === undefined ? Object.keys(lock.endpoints).sort() : [endpointKey("GET", opts.target)];
  const results: EndpointResult[] = [];
  for (const key of keys) results.push((await checkEndpoint(lock, methodOf(key), urlOf(key))).result);
  const summary = summarize(results);
  return { results, summary, exitCode: exitCodeFor(summary, opts.failOn) };
}
