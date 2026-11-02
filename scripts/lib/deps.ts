// Written with AI help.
// Dependency allowlist for the packages that probe, decide or ship (CLAUDE.md §5 rule 3a).
// Fail closed: every production dependency (transitive) of a guarded package must be on the
// allowlist; known wallet / signing / payment-client libraries get a specific message.

/** Guarded workspace packages. `paid-lock` is the CLI; the action joins in M4, runtime in M5. */
export const GUARDED = [
  "@paid-lock/core",
  "@paid-lock/protocols",
  "@paid-lock/probe",
  "paid-lock",
  "@paid-lock/action",
] as const;

/** Allowed production dependencies of guarded packages (exact names). Grows only by reviewed PR. */
export const ALLOWED = new Set<string>([
  "@paid-lock/core",
  "@paid-lock/protocols",
  "@paid-lock/probe",
  "paid-lock",
  // SHA-256 and Keccak-256 for integrity strings and EIP-55: pure JS, audited, no dependencies (D-016).
  "@noble/hashes",
  // Runtime validation of every external byte: lock files, 402 terms (D-005). No dependencies.
  "zod",
]);

/** Wallet, key, signing and payment-client libraries. Never allowed, whatever the allowlist says. */
export const WALLET_LIKE =
  /^(?:viem|ethers|web3|web3-.*|@ethersproject\/.*|@solana\/.*|@coinbase\/.*|@metamask\/.*|@walletconnect\/.*|@reown\/.*|wagmi|@wagmi\/.*|@noble\/(?:curves|secp256k1|ed25519)|@scure\/(?:bip32|bip39)|ethereum-cryptography|secp256k1|elliptic|tweetnacl|bip32|bip39|bitcoinjs-lib|@x402\/(?!core$).*|x402-.*|@stripe\/.*|mppx|@tempo.*)$/u;

export interface DepNode {
  name: string;
  dependencies?: Record<string, DepNode>;
}

export interface DepProblem {
  pkg: string;
  dep: string;
  path: string;
  reason: "wallet-or-signing-library" | "not-on-allowlist";
}

/** Walk one package's production dependency tree. Pure. */
export function checkPackage(root: DepNode, allowed: ReadonlySet<string> = ALLOWED): DepProblem[] {
  const problems: DepProblem[] = [];
  const seen = new Set<string>();
  const walk = (node: DepNode, trail: string[]): void => {
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      const path = [...trail, name].join(" > ");
      if (WALLET_LIKE.test(name)) {
        problems.push({ pkg: root.name, dep: name, path, reason: "wallet-or-signing-library" });
      } else if (!allowed.has(name)) {
        problems.push({ pkg: root.name, dep: name, path, reason: "not-on-allowlist" });
      }
      if (!seen.has(name)) {
        seen.add(name);
        walk(child, [...trail, name]);
      }
    }
  };
  walk(root, [root.name]);
  return problems;
}
