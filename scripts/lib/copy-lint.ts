// copy-lint (CLAUDE.md §5 rules 6, 7, 8; rule 7 now bans AI-authorship labels, owner decision of 3 Nov 2026). Design follows the copy-lint idea of the
// -claw-guard-near- reference repo (three verdict strings, banned words); code written fresh.
// This file holds the banned list, so it is the one file the scan skips (plus CLAUDE.md,
// which quotes the rules, and generated or legal files).

/** Banned in any user-facing text: verdict-style claims about sellers and token promotion. */
export const BANNED =
  /\b(?:safe(?:ly|st|r)?|scam(?:s|mer|mers|my)?|trusted|trustworthy|verified[ -]sellers?|presale|pre-sale|staking|airdrops?|token sale)\b/giu;

/**
 * Third-party identifiers that contain a banned word but make no claim about a seller (CLAUDE.md §5 rule 6
 * exempts them): npm's "trusted publishing" / "Trusted Publisher" feature, named in the release runbook.
 * Removed from a line before the banned-word scan; nothing else is exempt.
 */
const THIRD_PARTY_NAMES = /\btrusted publish(?:ing|ers?)\b/giu;

/** Files never scanned for banned words. */
export const SKIP_FILES = new Set(["CLAUDE.md", "LICENSE", "pnpm-lock.yaml", "scripts/lib/copy-lint.ts"]);

/** Text files the scan reads, by extension. */
const TEXT_EXT = /\.(?:md|ts|js|mjs|cjs|json|ya?ml|toml|sh|txt)$/u;

/**
 * AI-authorship labels (CLAUDE.md §5 rule 7, owner decision of 3 Nov 2026, same as Claw-Pay's rule 6):
 * code, docs, fixtures and output carry no such header or line.
 */
export const AI_LABEL =
  /\b(?:written with ai help|ai[- ](?:generated|written|authored)|(?:generated|written) (?:by|with) (?:ai|an ai)\b)/iu;

export interface Finding {
  file: string;
  line: number;
  message: string;
}

export function isScanned(file: string): boolean {
  // The bundled Action is generated from scanned sources plus third-party code (CLAUDE.md §5 rule 6).
  if (file.startsWith("action/dist/")) return false;
  return (TEXT_EXT.test(file) || file.startsWith(".githooks/")) && !SKIP_FILES.has(file);
}

/** Lint one file's text. Pure: no I/O. */
export function lintText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");
  lines.forEach((content, i) => {
    for (const m of content.replace(THIRD_PARTY_NAMES, "").matchAll(BANNED)) {
      findings.push({ file, line: i + 1, message: `banned word "${m[0]}"` });
    }
    if (AI_LABEL.test(content)) {
      findings.push({ file, line: i + 1, message: "AI-authorship label (none allowed, owner decision of 3 Nov 2026)" });
    }
  });
  return findings;
}
