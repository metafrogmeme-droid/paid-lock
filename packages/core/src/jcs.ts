// Written with AI help.
// RFC 8785 JSON Canonicalization Scheme (https://www.rfc-editor.org/rfc/rfc8785).
// Strings and numbers use the ECMAScript serialisation the RFC is defined by (JSON.stringify);
// object keys are sorted by UTF-16 code units; input must be I-JSON (no lone surrogates).
import type { Json } from "./json.ts";

export class CanonicalizationError extends Error {
  override readonly name = "CanonicalizationError";
}

/** Same limit as the protocol parsers (CLAUDE.md §3 item 3). */
export const MAX_DEPTH = 64;

function serialiseString(s: string): string {
  if (!s.isWellFormed()) throw new CanonicalizationError("string contains a lone surrogate");
  return JSON.stringify(s);
}

function compareUtf16(a: string, b: string): number {
  // JS string comparison is by UTF-16 code units, which is what RFC 8785 §3.2.3 requires.
  return a < b ? -1 : a > b ? 1 : 0;
}

function serialise(value: unknown, depth: number): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalizationError("number is not finite");
      return JSON.stringify(value);
    case "string":
      return serialiseString(value);
    case "object": {
      // Depth counts containers (arrays and objects), like the parsers' depth limit.
      if (depth > MAX_DEPTH) throw new CanonicalizationError(`nesting exceeds depth ${String(MAX_DEPTH)}`);
      if (Array.isArray(value)) return `[${value.map((v) => serialise(v, depth + 1)).join(",")}]`;
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new CanonicalizationError("only plain objects are JSON");
      }
      const entries = Object.entries(value).sort(([a], [b]) => compareUtf16(a, b));
      return `{${entries.map(([k, v]) => `${serialiseString(k)}:${serialise(v, depth + 1)}`).join(",")}}`;
    }
    case "bigint":
    case "function":
    case "symbol":
    case "undefined":
      throw new CanonicalizationError(`${typeof value} is not a JSON value`);
  }
  // TypeScript cannot prove the switch over `typeof` is exhaustive; this line is unreachable.
  /* v8 ignore next */
  throw new CanonicalizationError("not a JSON value");
}

/** Canonical JSON text of `value` (RFC 8785). Throws {@link CanonicalizationError} on non-I-JSON input. */
export function canonicalize(value: Json): string {
  return serialise(value, 1);
}
