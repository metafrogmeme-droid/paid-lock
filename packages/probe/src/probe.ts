// Written with AI help.
// The unpaid probe (CLAUDE.md §3 item 4, §5 rule 3). One plain request per sample:
//   - only `accept`, `user-agent` (and `content-type` for a POST fixture body) are set; no cookies,
//     no auth, never a payment header; no wallet or key anywhere in this package;
//   - redirects are never followed (reported without the Location value, §5 rule 13);
//   - https only, plain http on loopback only; time limit; body size limit; 2 samples by default.
import { normalizeUrl, type Method, type Observation } from "@paid-lock/core";
import { MAX_BODY_BYTES, observe402 } from "@paid-lock/protocols";
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
}

export interface ProbeResult {
  url: string;
  samples: Observation[];
}

/** Read at most `max` bytes of a body; null if it is larger. */
async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (body === null) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > max) {
      await body.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(chunk);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
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
  const cause = err instanceof Error ? (err.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === "string" ? cause.code : "request failed";
}

async function probeOnce(
  target: URL,
  opts: Required<Omit<ProbeOptions, "body" | "samples">> & { body?: string },
): Promise<Observation> {
  const headers: Record<string, string> = { accept: "application/json", "user-agent": USER_AGENT };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(target, {
      method: opts.method,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs),
      ...(opts.body === undefined ? {} : { body: opts.body }),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return { kind: "timeout" };
    return { kind: "not402", status: 0, detail: errorCode(err) };
  }
  try {
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      return { kind: "not402", status: res.status, detail: redirectDetail(target, res.headers.get("location")) };
    }
    if (res.status !== 402) {
      await res.body?.cancel();
      return { kind: "not402", status: res.status };
    }
    const header = res.headers.get("payment-required");
    if (header !== null) {
      await res.body?.cancel();
      return observe402({ status: 402, headers: { "payment-required": header }, body: "" });
    }
    const bytes = await readCapped(res.body, opts.maxBodyBytes);
    if (bytes === null)
      return { kind: "unreadable", reason: `response body is larger than ${String(opts.maxBodyBytes)} bytes` };
    return observe402({ status: 402, headers: {}, body: new TextDecoder().decode(bytes) });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return { kind: "timeout" };
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
  const opts = {
    method,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBodyBytes: options.maxBodyBytes ?? MAX_BODY_BYTES,
    ...(options.body === undefined ? {} : { body: options.body }),
  };
  const results: Observation[] = [];
  for (let i = 0; i < samples; i += 1) results.push(await probeOnce(target, opts));
  return { url: normalized.value, samples: results };
}
