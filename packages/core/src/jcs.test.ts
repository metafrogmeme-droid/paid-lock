import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalize, CanonicalizationError, prettyCanonical } from "./jcs.ts";
import type { Json } from "./json.ts";

describe("canonicalize (RFC 8785 JCS)", () => {
  it("matches the RFC 8785 \u00a73.2.2 example", () => {
    const input = JSON.parse(
      '{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001], "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/", "literals": [null, true, false]}',
    ) as Json;
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"\u20ac$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("sorts keys by UTF-16 code units (RFC 8785 \u00a73.2.3 example)", () => {
    const input = JSON.parse(
      '{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control","\\u00f6":"Latin Small Letter O With Diaeresis"}',
    ) as Record<string, Json>;
    // Read the order from the text: JSON.parse would move integer-like keys ("1") to the front.
    const text = canonicalize(input);
    const expected = ["\r", "1", "\u0080", "\u00f6", "\u20ac", "\ud83d\ude00", "\ufb33"];
    const order = expected.map((k) => text.indexOf(`${JSON.stringify(k)}:`));
    expect(order.every((pos) => pos > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it.each([
    [0, "0"],
    [-0, "0"],
    [5e-324, "5e-324"],
    [1.7976931348623157e308, "1.7976931348623157e+308"],
    [1e21, "1e+21"],
    [1e-7, "1e-7"],
    [9007199254740992, "9007199254740992"],
  ])("serialises the number %s as %s", (n, text) => {
    expect(canonicalize(n)).toBe(text);
  });

  it.each([NaN, Infinity, -Infinity])("rejects the non-finite number %s", (n) => {
    expect(() => canonicalize(n)).toThrow(CanonicalizationError);
  });

  it("rejects lone surrogates in strings and keys (I-JSON)", () => {
    expect(() => canonicalize("\ud800")).toThrow(/surrogate/);
    expect(() => canonicalize({ ["a\udc00"]: 1 })).toThrow(/surrogate/);
  });

  it("rejects values that are not JSON", () => {
    expect(() => canonicalize(undefined as unknown as Json)).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: undefined } as unknown as Json)).toThrow(CanonicalizationError);
    expect(() => canonicalize(new Date(0) as unknown as Json)).toThrow(/plain/);
    expect(() => canonicalize(1n as unknown as Json)).toThrow(CanonicalizationError);
  });

  it("rejects nesting deeper than 64 levels", () => {
    let deep: Json = 1;
    for (let i = 0; i < 65; i += 1) deep = [deep];
    expect(() => canonicalize(deep)).toThrow(/depth/);
    let ok: Json = 1;
    for (let i = 0; i < 64; i += 1) ok = [ok];
    expect(() => canonicalize(ok)).not.toThrow();
  });

  it("keeps array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  const json = fc.jsonValue({ maxDepth: 6 }) as fc.Arbitrary<Json>;

  it("property: output is valid JSON that parses back to an equal value", () => {
    fc.assert(
      fc.property(json, (v) => {
        expect(JSON.parse(canonicalize(v))).toEqual(JSON.parse(JSON.stringify(v)));
      }),
    );
  });

  it("property: idempotent (canonicalising the parsed output gives the same bytes)", () => {
    fc.assert(
      fc.property(json, (v) => {
        const once = canonicalize(v);
        expect(canonicalize(JSON.parse(once) as Json)).toBe(once);
      }),
    );
  });

  it("property: independent of object key insertion order", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), json), (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse());
        expect(canonicalize(reversed)).toBe(canonicalize(obj));
      }),
    );
  });
});

describe("prettyCanonical (lockfile layout)", () => {
  it("indents by two spaces, sorts keys and ends with one newline", () => {
    expect(prettyCanonical({ b: [1, { d: null, c: "x" }], a: {}, e: [] })).toBe(
      '{\n  "a": {},\n  "b": [\n    1,\n    {\n      "c": "x",\n      "d": null\n    }\n  ],\n  "e": []\n}\n',
    );
  });

  it("property: parses back to the same canonical value", () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 6 }) as fc.Arbitrary<Json>, (v) => {
        expect(canonicalize(JSON.parse(prettyCanonical(v)) as Json)).toBe(canonicalize(v));
      }),
    );
  });
});
