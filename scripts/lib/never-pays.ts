// Written with AI help.
// Never-pays source scan (CLAUDE.md §5 rule 3b). The request-side payment header names and
// wallet/signing calls must not appear in shipped code. The names live only here, in the mock
// seller (which detects them) and in tests that plant them.

export const FORBIDDEN: readonly { id: string; pattern: RegExp }[] = [
  { id: "x402-v2-payment-header", pattern: /payment-signature/iu },
  { id: "x402-v1-payment-header", pattern: /x-payment(?!-response)\b/iu },
  { id: "mpp-payment-credential", pattern: /authorization["'`]?\s*[:,=]\s*["'`]?payment\b/iu },
  { id: "facilitator-call", pattern: /\/(?:verify|settle)\b["'`]/u },
  {
    id: "signing-call",
    pattern:
      /\b(?:signTypedData|signMessage|signTransaction|eth_sign\w*|personal_sign|privateKeyToAccount|mnemonicToAccount|fromMnemonic|Keypair\.fromSecretKey)\b/u,
  },
];

/** Shipped code: package sources (not tests) and, from M4, the action and its bundle. */
export function isShippedCode(file: string): boolean {
  if (/\.test\.[cm]?[jt]s$/u.test(file)) return false;
  return /^packages\/[^/]+\/src\/.+\.[cm]?[jt]s$/u.test(file) || /^action\/.+\.[cm]?js$|^action\/.+\.ts$/u.test(file);
}

export interface Hit {
  file: string;
  line: number;
  id: string;
}

export function scanText(file: string, text: string): Hit[] {
  const hits: Hit[] = [];
  text.split("\n").forEach((content, i) => {
    for (const { id, pattern } of FORBIDDEN) if (pattern.test(content)) hits.push({ file, line: i + 1, id });
  });
  return hits;
}
