// Input guards for 402 data (CLAUDE.md §3 item 3): size limits, strict Base64, JSON depth <= 64 and
// no duplicate object keys. Duplicate keys are refused because JSON parsers disagree on which value
// wins, so a seller could show one payTo to paid.lock and another to the paying client.
import { base64, parseJsonGuarded as coreParseJsonGuarded } from "@paid-lock/core";

export const MAX_HEADER_BYTES = 128 * 1024;
export const MAX_BODY_BYTES = 1024 * 1024;

export type Guarded<T> = { ok: true } & T;
export interface Refused {
  ok: false;
  reason: string;
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Standard, padded, canonical Base64 (RFC 4648 §4) of UTF-8 text. */
export function decodeBase64Strict(input: string, maxBytes = MAX_HEADER_BYTES): Guarded<{ text: string }> | Refused {
  if (input.length === 0) return { ok: false, reason: "empty Base64" };
  if (input.length > maxBytes) return { ok: false, reason: "Base64 text is too large" };
  if (!BASE64.test(input)) return { ok: false, reason: "not standard padded Base64" };
  const bytes = Uint8Array.from(atob(input), (ch) => ch.charCodeAt(0));
  if (base64(bytes) !== input) return { ok: false, reason: "non-canonical Base64" };
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes) };
  } catch {
    return { ok: false, reason: "Base64 content is not UTF-8" };
  }
}

/** The core's guarded JSON parser (size, depth <= 64, no duplicate keys), with the body limit as default. */
export function parseJsonGuarded(text: string, maxBytes = MAX_BODY_BYTES): Guarded<{ value: unknown }> | Refused {
  return coreParseJsonGuarded(text, maxBytes);
}
