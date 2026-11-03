import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeBase64Strict, parseJsonGuarded } from "./guard.ts";

describe("decodeBase64Strict", () => {
  it("decodes canonical standard Base64 to UTF-8 text", () => {
    expect(decodeBase64Strict("eyJhIjoxfQ==")).toEqual({ ok: true, text: '{"a":1}' });
  });

  it.each([
    ["empty", ""],
    ["whitespace", "eyJh IjoxfQ=="],
    ["base64url alphabet", "eyJh-_oxfQ=="],
    ["missing padding", "eyJhIjoxfQ"],
    ["non-canonical padding bits", "QR=="],
    ["data after padding", "QQ==QQ=="],
    ["invalid UTF-8", "/w=="],
  ])("refuses %s", (_name, input) => {
    expect(decodeBase64Strict(input).ok).toBe(false);
  });

  it("refuses input above the size limit", () => {
    expect(decodeBase64Strict("A".repeat(1000), 100).ok).toBe(false);
  });

  it("property: round-trips any UTF-8 text", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (s) => {
        fc.pre(s.length > 0);
        expect(decodeBase64Strict(Buffer.from(s, "utf8").toString("base64"))).toEqual({ ok: true, text: s });
      }),
    );
  });
});

describe("parseJsonGuarded", () => {
  it("parses ordinary JSON", () => {
    expect(parseJsonGuarded('{"a":[1,{"b":"c"}],"d":null}')).toEqual({
      ok: true,
      value: { a: [1, { b: "c" }], d: null },
    });
  });

  it("refuses duplicate keys, also when spelled with escapes (parsers would disagree)", () => {
    expect(parseJsonGuarded('{"payTo":"A","payTo":"B"}').ok).toBe(false);
    expect(parseJsonGuarded('{"payTo":"A","\\u0070ayTo":"B"}').ok).toBe(false);
    expect(parseJsonGuarded('{"a":{"x":1},"b":{"x":2}}').ok).toBe(true);
  });

  it("refuses nesting deeper than 64 without recursion", () => {
    expect(parseJsonGuarded(`${"[".repeat(65)}${"]".repeat(65)}`).ok).toBe(false);
    expect(parseJsonGuarded(`${"[".repeat(64)}${"]".repeat(64)}`).ok).toBe(true);
    expect(parseJsonGuarded("[".repeat(100000)).ok).toBe(false);
  });

  it("does not count brackets inside strings", () => {
    expect(parseJsonGuarded(JSON.stringify({ s: "[".repeat(200) + '"{' }))).toMatchObject({ ok: true });
  });

  it("refuses an object key with an invalid escape", () => {
    expect(parseJsonGuarded('{"\\q":1}')).toEqual({ ok: false, reason: "invalid JSON string" });
  });

  it("refuses invalid JSON and oversized text", () => {
    expect(parseJsonGuarded("{").ok).toBe(false);
    expect(parseJsonGuarded("{} x").ok).toBe(false);
    expect(parseJsonGuarded("[1]", 2).ok).toBe(false);
  });

  it("property: never throws and agrees with JSON.parse on valid JSON without duplicate keys", () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 8 }), (v) => {
        const text = JSON.stringify(v);
        expect(parseJsonGuarded(text)).toEqual({ ok: true, value: JSON.parse(text) as unknown });
      }),
    );
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => parseJsonGuarded(s)).not.toThrow();
      }),
    );
  });
});
