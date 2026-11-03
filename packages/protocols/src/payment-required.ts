// A PaymentRequired that an x402 client has already decoded (from the PAYMENT-REQUIRED header for
// v2, from the JSON body for v1), as a runtime hook receives it. It goes through the same guards as
// the raw forms: it is serialised to JSON text first, so the depth, size and schema checks are the
// ones the header and body parsers apply, and anything that is not plain JSON is refused.
import { MAX_BODY_BYTES, MAX_HEADER_BYTES, parseJsonGuarded } from "./guard.ts";
import { fromV1Json, fromV2Json, type ParseResult } from "./x402.ts";

function toJsonText(value: unknown): string | undefined {
  try {
    const text = JSON.stringify(value) as string | undefined;
    return typeof text === "string" ? text : undefined;
  } catch {
    // Cycles and bigint values throw: not a JSON value.
    return undefined;
  }
}

export function parsePaymentRequired(value: unknown): ParseResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "PaymentRequired is not a JSON object" };
  }
  const text = toJsonText(value);
  if (text === undefined) return { ok: false, reason: "not a JSON value" };
  const version = (value as { x402Version?: unknown }).x402Version;
  if (version !== 1 && version !== 2) return { ok: false, reason: "unknown x402Version" };
  const json = parseJsonGuarded(text, version === 2 ? MAX_HEADER_BYTES : MAX_BODY_BYTES);
  if (!json.ok) return json;
  return version === 2 ? fromV2Json(json.value) : fromV1Json(json.value);
}
