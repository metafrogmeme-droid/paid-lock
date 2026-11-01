// Written with AI help.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeAddress, toChecksumAddress } from "./address.ts";

// EIP-55 test vectors (https://eips.ethereum.org/EIPS/eip-55).
const EIP55 = [
  "0x52908400098527886E0F7030069857D2E4169EE7",
  "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
  "0xde709f2102306220921060314715629080e2fb77",
  "0x27b1fdb04752bbc536007a920d24acb045561c26",
  "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
  "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
  "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
];

describe("toChecksumAddress (EIP-55)", () => {
  it.each(EIP55)("reproduces %s", (addr) => {
    expect(toChecksumAddress(addr.toLowerCase())).toBe(addr);
  });

  it("checksums the Base Sepolia USDC contract from the x402 spec example", () => {
    expect(toChecksumAddress("0x036cbd53842c5426634e7929541ec2318f3dcf7e")).toBe(
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    );
  });
});

describe("normalizeAddress", () => {
  it("stores EVM addresses on eip155 networks EIP-55 checksummed", () => {
    expect(normalizeAddress("eip155:84532", "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed")).toEqual({
      ok: true,
      value: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    });
    expect(normalizeAddress("eip155:1", "0X5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED")).toEqual({
      ok: true,
      value: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    });
  });

  it("refuses a mixed-case EVM address with a wrong checksum (likely a typo or tampering)", () => {
    const r = normalizeAddress("eip155:8453", "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
    expect(r.ok).toBe(false);
  });

  it("keeps non-address values on eip155 exactly (role constants, ISO 4217 codes)", () => {
    expect(normalizeAddress("eip155:8453", "merchant")).toEqual({ ok: true, value: "merchant" });
    expect(normalizeAddress("eip155:8453", "USD")).toEqual({ ok: true, value: "USD" });
  });

  it("compares non-EVM addresses exactly (no case folding)", () => {
    const sol = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    expect(normalizeAddress("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", sol)).toEqual({ ok: true, value: sol });
    expect(normalizeAddress("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", sol.toLowerCase())).toEqual({
      ok: true,
      value: sol.toLowerCase(),
    });
  });

  it("refuses empty values and values with whitespace or control characters", () => {
    for (const v of ["", " 0xabc", "a b", "x\n", "\u0000"]) expect(normalizeAddress("eip155:1", v).ok).toBe(false);
  });

  it("property: an EVM address normalises to the same value whatever its case", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 20, maxLength: 20 }), (bytes) => {
        const hex = `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
        const lower = normalizeAddress("eip155:84532", hex);
        const upper = normalizeAddress("eip155:84532", `0x${hex.slice(2).toUpperCase()}`);
        expect(lower).toEqual(upper);
        expect(lower.ok && normalizeAddress("eip155:84532", lower.value)).toEqual(lower);
      }),
    );
  });
});
