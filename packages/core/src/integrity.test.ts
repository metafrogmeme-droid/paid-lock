// Written with AI help.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { base64, integrityOf, isIntegrity, sha256Base64 } from "./integrity.ts";
import type { Json } from "./json.ts";

describe("integrity strings (SRI style)", () => {
  it("hashes the UTF-8 bytes with SHA-256 and encodes standard Base64 (known vectors)", () => {
    // NIST / RFC 6234 vectors: SHA-256("") and SHA-256("abc").
    expect(sha256Base64("")).toBe("47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
    expect(sha256Base64("abc")).toBe("ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
  });

  it("encodes non-ASCII text as UTF-8 before hashing", () => {
    // SHA-256 of the UTF-8 bytes of the euro sign (E2 82 AC).
    expect(sha256Base64("\u20ac")).toBe(sha256Base64(String.fromCodePoint(0x20ac)));
    expect(sha256Base64("\u20ac")).not.toBe(sha256Base64("\u00e2\u0082\u00ac"));
  });

  it("encodes Base64 like RFC 4648 for every padding case", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 40 }), (bytes) => {
        expect(base64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
      }),
    );
    expect(base64(new Uint8Array())).toBe("");
  });

  it("prefixes the algorithm like Subresource Integrity", () => {
    expect(integrityOf({})).toBe(`sha256-${sha256Base64("{}")}`);
  });

  it("recognises well-formed integrity strings only", () => {
    expect(isIntegrity(integrityOf({ a: 1 }))).toBe(true);
    expect(isIntegrity("sha256-short")).toBe(false);
    expect(isIntegrity("sha384-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=")).toBe(false);
    expect(isIntegrity("sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU")).toBe(false);
  });

  const json = fc.jsonValue({ maxDepth: 5 }) as fc.Arbitrary<Json>;

  it("property: the hash ignores object key order", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), json), (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse());
        expect(integrityOf(reversed)).toBe(integrityOf(obj));
      }),
    );
  });

  it("property: any change to a value changes the hash", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b);
        expect(integrityOf({ k: a })).not.toBe(integrityOf({ k: b }));
      }),
    );
  });
});
