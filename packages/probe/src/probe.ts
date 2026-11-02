// Written with AI help.
// The unpaid probe (CLAUDE.md §3 item 4, §5 rule 3). One plain request per sample:
//   - only `host`, `accept`, `user-agent` (and `content-type` for a POST fixture body) are set; no
//     cookies, no auth, never a payment header; no wallet or key anywhere in this package;
//   - redirects are never followed (reported without the Location value, §5 rule 13);
//   - https only, plain http on loopback only; time limit; body size limit; 2 samples by default;
//   - private, link-local and loopback addresses are refused unless the lock entry opts in
//     (allowPrivateNetwork). DNS is resolved once per request, every answer is checked, and the
//     connection goes to exactly the checked address (no second lookup, so no DNS rebinding).
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { normalizeUrl, type Method, type Observation } from "@paid-lock/core";
import { MAX_BODY_BYTES, observe402 } from "@paid-lock/protocols";
import { checkResolved, classifyAddress, hostLiteral, type ResolvedAddress } from "./address-policy.ts";
import { checkProbeUrl, ProbeUrlError } from "./url-policy.ts";

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_SAMPLES = 2;
export const USER_AGENT = "paid-lock-probe (unpaid; never pays)";

export interface ProbeOptions {
  method?: Method;
  /** JSON fixture body for POST endpoints. */
  body?: string;
  timeoutMs?: number;
  /** Identical requests to send (1-5). Two catch terms that change between requests. */
  samples?: number;
  maxBodyBytes?: number;
  /** Allow private, link-local and loopback targets (the lock entry's policy.allowPrivateNetwork). */
  allowPrivateNetwork?: boolean;
  /** DNS resolver; tests replace it. Default: the system resolver, all addresses. */
  resolve?: Resolver;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

const systemResolver: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true, order: "verbatim" })).map((a) => ({
    address: a.address,
    family: a.family === 6 ? 6 : 4,
  }));

export interface ProbeResult {
  url: string;
  samples: Observation[];
}

/** Read at most `max` bytes of a response body; null if it is larger. */
async function readCapped(res: IncomingMessage, max: number): Promise<Uint8Array | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res as AsyncIterable<Buffer>) {
    size += chunk.byteLength;
    if (size > max) {
      res.destroy();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function redirectDetail(target: URL, location: string | null): string {
  if (location === null) return "redirect without a target, not followed";
  try {
    return new URL(location, target).host === target.host
      ? "redirect on the same host, not followed"
      : "redirect to another host, not followed";
  } catch {
    return "redirect to an unreadable target, not followed";
  }
}

function errorCode(err: unknown): string {
  const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
  return typeof code === "string" ? code : "request failed";
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

type SampleOptions = Required<Omit<ProbeOptions, "body" | "samples">> & { body?: string };

/** Resolve (or read the literal) and check the target address. Throws ProbeUrlError when refused. */
async function targetAddress(target: URL, opts: SampleOptions): Promise<ResolvedAddress> {
  const literal = hostLiteral(target.hostname);
  if (literal !== undefined) {
    const c = classifyAddress(literal);
    if (!c.allowed && !opts.allowPrivateNetwork) throw new ProbeUrlError(refusal(target, `is a ${c.category} address`));
    return { address: literal, family: literal.includes(":") ? 6 : 4 };
  }
  let resolved: ResolvedAddress[];
  try {
    resolved = await opts.resolve(target.hostname);
  } catch (err) {
    throw new ProbeUrlError(`${target.hostname} could not be resolved (${errorCode(err)})`);
  }
  const checked = checkResolved(resolved, opts.allowPrivateNetwork);
  if (!checked.ok) throw new ProbeUrlError(refusal(target, checked.reason));
  return checked.address;
}

function refusal(target: URL, why: string): string {
  return `${target.host} ${why}; refused before any request (set "allowPrivateNetwork": true in this endpoint's policy only after review)`;
}

/** One unpaid request to exactly `address` (the connection never looks the name up again). Exported for tests. */
export function sendPinned(target: URL, address: ResolvedAddress, opts: SampleOptions): Promise<IncomingMessage> {
  const headers: Record<string, string> = { host: target.host, accept: "application/json", "user-agent": USER_AGENT };
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(Buffer.byteLength(opts.body));
  }
  const pinned: LookupFunction = (_host, options, callback) => {
    if (options.all === true) callback(null, [address]);
    else callback(null, address.address, address.family);
  };
  const request = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(target, {
      method: opts.method,
      headers,
      setHost: false,
      agent: false,
      lookup: pinned,
      signal: AbortSignal.timeout(opts.timeoutMs),
      ...(target.protocol === "https:" && hostLiteral(target.hostname) === undefined
        ? { servername: target.hostname }
        : {}),
    });
    req.once("response", resolve);
    req.once("error", reject);
    req.end(opts.body);
  });
}

async function probeOnce(target: URL, opts: SampleOptions): Promise<Observation> {
  const address = await targetAddress(target, opts);
  let res: IncomingMessage;
  try {
    res = await sendPinned(target, address, opts);
  } catch (err) {
    if (isTimeout(err)) return { kind: "timeout" };
    return { kind: "not402", status: 0, detail: errorCode(err) };
  }
  const status = res.statusCode ?? 0;
  try {
    if (status >= 300 && status < 400) {
      res.destroy();
      const location = res.headers.location;
      return { kind: "not402", status, detail: redirectDetail(target, typeof location === "string" ? location : null) };
    }
    if (status !== 402) {
      res.destroy();
      return { kind: "not402", status };
    }
    const header = res.headers["payment-required"];
    if (typeof header === "string") {
      res.destroy();
      return observe402({ status: 402, headers: { "payment-required": header }, body: "" });
    }
    const bytes = await readCapped(res, opts.maxBodyBytes);
    if (bytes === null)
      return { kind: "unreadable", reason: `response body is larger than ${String(opts.maxBodyBytes)} bytes` };
    return observe402({ status: 402, headers: {}, body: new TextDecoder().decode(bytes) });
  } catch (err) {
    if (isTimeout(err)) return { kind: "timeout" };
    return { kind: "unreadable", reason: "response could not be read" };
  }
}

/** Probe one endpoint without paying. Throws ProbeUrlError / RangeError on bad input, before any request. */
export async function probe(url: string, options: ProbeOptions = {}): Promise<ProbeResult> {
  const normalized = normalizeUrl(url);
  if (!normalized.ok) throw new ProbeUrlError(normalized.reason);
  const target = checkProbeUrl(normalized.value);
  const samples = options.samples ?? DEFAULT_SAMPLES;
  if (!Number.isInteger(samples) || samples < 1 || samples > 5) throw new RangeError("samples must be 1 to 5");
  const method = options.method ?? "GET";
  if (options.body !== undefined && method !== "POST") throw new RangeError("a request body needs method POST");
  const opts: SampleOptions = {
    method,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBodyBytes: options.maxBodyBytes ?? MAX_BODY_BYTES,
    allowPrivateNetwork: options.allowPrivateNetwork ?? false,
    resolve: options.resolve ?? systemResolver,
    ...(options.body === undefined ? {} : { body: options.body }),
  };
  const results: Observation[] = [];
  for (let i = 0; i < samples; i += 1) results.push(await probeOnce(target, opts));
  return { url: normalized.value, samples: results };
}
