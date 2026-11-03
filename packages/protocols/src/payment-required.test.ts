import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_HEADER_BYTES } from "./guard.ts";
import { parsePaymentRequired } from "./payment-required.ts";
import { parseX402V1Body, parseX402V2Header } from "./x402.ts";

// Same shapes as the x402 spec examples (x402 @ e208bd3); addresses from the v2 spec example.
const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PAY = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const RESOURCE = "https://api.example.com/premium-data";

const v2 = (req: Record<string, unknown> = {}): Record<string, unknown> => ({
  x402Version: 2,
  error: "payment required",
  resource: { url: RESOURCE },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      amount: "10000",
      asset: ASSET,
      payTo: PAY,
      maxTimeoutSeconds: 60,
      extra: { name: "USDC", version: "2" },
      ...req,
    },
  ],
});
const v1 = (): Record<string, unknown> => ({
  x402Version: 1,
  error: "payment required",
  accepts: [
    {
      scheme: "exact",
      network: "base-sepolia",
      maxAmountRequired: "10000",
      asset: ASSET,
      payTo: PAY,
      resource: RESOURCE,
      description: "Access to premium market data",
      mimeType: "application/json",
      maxTimeoutSeconds: 60,
      extra: { name: "USDC", version: "2" },
    },
  ],
});
const header = (obj: unknown): string => Buffer.from(JSON.stringify(obj), "utf8").toString("base64");

function nested(depth: number): unknown {
  let v: unknown = "x";
  for (let i = 0; i < depth; i += 1) v = { a: v };
  return v;
}

describe("parsePaymentRequired (an already decoded PaymentRequired object)", () => {
  it("reads an x402 v2 object exactly like the PAYMENT-REQUIRED header that carries it", () => {
    expect(parsePaymentRequired(v2())).toEqual(parseX402V2Header(header(v2())));
  });

  it("reads an x402 v1 body object exactly like the JSON body text", () => {
    expect(parsePaymentRequired(v1())).toEqual(parseX402V1Body(JSON.stringify(v1())));
  });

  it.each([
    ["null", null],
    ["a string", "eyJ4NDAyVmVyc2lvbiI6Mn0="],
    ["a number", 402],
    ["an array", [v2()]],
    ["undefined", undefined],
  ])("refuses %s", (_name, value) => {
    const r = parsePaymentRequired(value);
    expect(r.ok).toBe(false);
  });

  it("refuses an unknown or missing x402Version", () => {
    expect(parsePaymentRequired({ ...v2(), x402Version: 3 })).toEqual({
      ok: false,
      reason: "unknown x402Version",
    });
    const noVersion = v2();
    delete noVersion["x402Version"];
    expect(parsePaymentRequired(noVersion)).toEqual({ ok: false, reason: "unknown x402Version" });
  });

  it("refuses values that are not plain JSON (cycles, bigint)", () => {
    const cyclic: Record<string, unknown> = v2();
    cyclic["self"] = cyclic;
    expect(parsePaymentRequired(cyclic)).toEqual({ ok: false, reason: "not a JSON value" });
    expect(parsePaymentRequired({ ...v2(), n: 1n })).toEqual({ ok: false, reason: "not a JSON value" });
  });

  it("applies the same depth and size limits as the header parser", () => {
    expect(parsePaymentRequired({ ...v2(), extensions: { deep: nested(80) } })).toMatchObject({ ok: false });
    const big = { ...v2(), extensions: { pad: { info: "x".repeat(MAX_HEADER_BYTES), schema: {} } } };
    expect(parsePaymentRequired(big)).toEqual({ ok: false, reason: "JSON text is too large" });
  });

  it("is unreadable when a required v2 field is missing (fail closed)", () => {
    const r = parsePaymentRequired(v2({ payTo: undefined }));
    expect(r.ok).toBe(false);
  });

  it("property: object and header forms always agree", () => {
    fc.assert(
      fc.property(
        fc.record({
          amount: fc.bigInt({ min: 0n, max: 10n ** 30n }).map(String),
          scheme: fc.constantFrom("exact", "upto"),
          maxTimeoutSeconds: fc.integer({ min: 1, max: 3600 }),
          extra: fc.dictionary(fc.string({ maxLength: 8 }), fc.string({ maxLength: 8 }), { maxKeys: 4 }),
        }),
        (req) => {
          const obj = v2(req);
          expect(parsePaymentRequired(obj)).toEqual(parseX402V2Header(header(obj)));
        },
      ),
    );
  });

  it("property: never throws, whatever it is given", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(typeof parsePaymentRequired(value).ok).toBe("boolean");
      }),
    );
  });
});
