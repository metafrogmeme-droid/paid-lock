// Written with AI help.
import { describe, expect, it } from "vitest";
import { V1_NETWORK_NAMES, v1NetworkToCaip2 } from "./networks.ts";

describe("v1NetworkToCaip2", () => {
  it.each([
    ["base-sepolia", "eip155:84532"],
    ["base", "eip155:8453"],
    ["avalanche-fuji", "eip155:43113"],
    ["ethereum", "eip155:1"],
    ["solana", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
    ["solana-devnet", "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"],
  ])("maps %s to %s", (name, caip2) => {
    expect(v1NetworkToCaip2(name)).toBe(caip2);
  });

  it.each(["Base-Sepolia", "base_sepolia", "eip155:84532", "toString", "__proto__", ""])(
    "returns undefined for %j (no guessing)",
    (name) => {
      expect(v1NetworkToCaip2(name)).toBeUndefined();
    },
  );

  it("maps every listed name to a CAIP-2 id", () => {
    expect(V1_NETWORK_NAMES).toHaveLength(27);
    for (const n of V1_NETWORK_NAMES) expect(v1NetworkToCaip2(n)).toMatch(/^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/);
  });
});
