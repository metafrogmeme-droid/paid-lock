// Written with AI help.
// copy-lint (CLAUDE.md §5 rules 6, 7, 8). Design follows the copy-lint idea of the
// -claw-guard-near- reference repo (three verdict strings, banned words); code written fresh.
// This file holds the banned list, so it is the one file the scan skips (plus CLAUDE.md,
// which quotes the rules, and generated or legal files).

/** Banned in any user-facing text: verdict-style claims about sellers and token promotion. */
export const BANNED =
  /\b(?:safe(?:ly|st|r)?|scam(?:s|mer|mers|my)?|trusted|trustworthy|verified[ -]sellers?|presale|pre-sale|staking|airdrops?|token sale)\b/giu;

/** Files never scanned for banned words. */
export const SKIP_FILES = new Set(["CLAUDE.md", "LICENSE", "pnpm-lock.yaml", "scripts/lib/copy-lint.ts"]);

/** Text files the scan reads, by extension. */
const TEXT_EXT = /\.(?:md|ts|js|mjs|cjs|json|ya?ml|toml|sh|txt)$/u;

/** Files whose first lines must carry the AI-help label (rule 7). */
const LABEL_EXT = /\.(?:md|ts|js|mjs|cjs|sh|ya?ml|toml)$/u;
const LABEL_EXEMPT = new Set(["pnpm-lock.yaml"]);
const LABEL_TEXT = "Written with AI help";
const LABEL_WINDOW = 5;

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

function needsLabel(file: string): boolean {
  if (LABEL_EXEMPT.has(file) || SKIP_FILES.has(file)) return false;
  if (file.startsWith(".githooks/")) return true;
  if (/(?:^|\/)scenarios\/[^/]+\.json$/u.test(file)) return true;
  return LABEL_EXT.test(file);
}

/** Lint one file's text. Pure: no I/O. */
export function lintText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");
  lines.forEach((content, i) => {
    for (const m of content.matchAll(BANNED)) {
      findings.push({ file, line: i + 1, message: `banned word "${m[0]}"` });
    }
  });
  if (needsLabel(file) && !lines.slice(0, LABEL_WINDOW).some((l) => l.includes(LABEL_TEXT))) {
    findings.push({
      file,
      line: 1,
      message: `missing "${LABEL_TEXT}" label in the first ${String(LABEL_WINDOW)} lines`,
    });
  }
  return findings;
}
