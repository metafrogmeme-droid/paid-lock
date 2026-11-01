// Written with AI help.
import { describe, expect, it } from "vitest";
import { checkPackage, WALLET_LIKE, type DepNode } from "../scripts/lib/deps.ts";

const tree = (deps: Record<string, DepNode>): DepNode => ({ name: "@paid-lock/probe", dependencies: deps });

describe("dependency allowlist", () => {
  it("passes a tree with only allowlisted workspace packages", () => {
    expect(checkPackage(tree({ "@paid-lock/core": { name: "@paid-lock/core" } }))).toEqual([]);
  });

  it("blocks a planted wallet library, even when nested", () => {
    const problems = checkPackage(
      tree({ "@paid-lock/core": { name: "@paid-lock/core", dependencies: { viem: { name: "viem" } } } }),
    );
    expect(problems).toEqual([
      {
        pkg: "@paid-lock/probe",
        dep: "viem",
        path: "@paid-lock/probe > @paid-lock/core > viem",
        reason: "wallet-or-signing-library",
      },
    ]);
  });

  it("blocks a wallet library even if someone adds it to the allowlist", () => {
    const problems = checkPackage(tree({ ethers: { name: "ethers" } }), new Set(["ethers"]));
    expect(problems[0]?.reason).toBe("wallet-or-signing-library");
  });

  it("fails closed on any dependency that is not allowlisted", () => {
    expect(checkPackage(tree({ "left-pad": { name: "left-pad" } }))[0]?.reason).toBe("not-on-allowlist");
  });

  it.each([
    "viem",
    "ethers",
    "@solana/web3.js",
    "@coinbase/cdp-sdk",
    "@noble/secp256k1",
    "@noble/curves",
    "@scure/bip39",
    "tweetnacl",
    "@x402/fetch",
    "@x402/evm",
    "x402-axios",
    "web3",
  ])("knows %s is wallet-like", (name) => {
    expect(WALLET_LIKE.test(name)).toBe(true);
  });

  it.each(["zod", "undici", "@x402/core", "@noble/hashes"])("does not call %s wallet-like", (name) => {
    expect(WALLET_LIKE.test(name)).toBe(false);
  });
});
