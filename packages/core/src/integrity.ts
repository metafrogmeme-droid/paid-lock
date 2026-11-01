// Written with AI help.
// `sha256-<base64>` integrity strings over RFC 8785 canonical JSON, in the style of
// Subresource Integrity (https://www.w3.org/TR/SRI/). SHA-256 from @noble/hashes (pure, audited,
// no dependencies; see docs/DECISIONS.md D-016), so the core stays free of Node built-ins.
import { sha256 } from "@noble/hashes/sha2.js";
import { canonicalize } from "./jcs.ts";
import type { Json } from "./json.ts";

export type Integrity = `sha256-${string}`;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const INTEGRITY = /^sha256-[A-Za-z0-9+/]{43}=$/;

/** Standard Base64 (RFC 4648 §4) with padding. */
export function base64(bytes: Uint8Array): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = ((acc << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += B64.charAt((acc >> bits) & 63);
    }
  }
  if (bits > 0) out += B64.charAt((acc << (6 - bits)) & 63);
  return out + "=".repeat((4 - (out.length % 4)) % 4);
}

/** Standard Base64 of SHA-256 over the UTF-8 bytes of `text`. */
export function sha256Base64(text: string): string {
  return base64(sha256(new TextEncoder().encode(text)));
}

/** Integrity string of a JSON value: SHA-256 over its RFC 8785 canonical form. */
export function integrityOf(value: Json): Integrity {
  return `sha256-${sha256Base64(canonicalize(value))}`;
}

export function isIntegrity(value: string): value is Integrity {
  return INTEGRITY.test(value);
}
