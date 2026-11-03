// Guarded JSON parsing, shared by the lock parser and the 402 parsers (packages/protocols): a size limit,
// nesting depth <= MAX_DEPTH and no duplicate object keys. Duplicate keys are refused because JSON parsers
// disagree on which value wins, so a reviewer (or another tool) could read a different value than the code.
import { MAX_DEPTH } from "./jcs.ts";

export type JsonGuardResult = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * One linear pass over the text: rejects nesting deeper than MAX_DEPTH and duplicate keys,
 * then JSON.parse. Strings are skipped with their escapes, so brackets inside them don't count.
 */
export function parseJsonGuarded(text: string, maxBytes: number): JsonGuardResult {
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, reason: "JSON text is too large" };
  const stack: { keys: Set<string> | null; expectKey: boolean }[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const top = stack.at(-1);
      if (top?.keys && top.expectKey) {
        let key: unknown;
        try {
          key = JSON.parse(text.slice(i, j + 1));
        } catch {
          return { ok: false, reason: "invalid JSON string" };
        }
        if (typeof key !== "string" || top.keys.has(key)) return { ok: false, reason: "duplicate object key" };
        top.keys.add(key);
        top.expectKey = false;
      }
      i = j;
    } else if (ch === "{" || ch === "[") {
      if (stack.length >= MAX_DEPTH) return { ok: false, reason: `JSON nests deeper than ${String(MAX_DEPTH)}` };
      stack.push({ keys: ch === "{" ? new Set() : null, expectKey: ch === "{" });
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    } else if (ch === ",") {
      const top = stack.at(-1);
      if (top?.keys) top.expectKey = true;
    }
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }
}
