/**
 * The only three verdicts paid.lock ever shows (CLAUDE.md §3 item 2, §5 rule 6).
 * Every user-facing check result is produced by {@link verdictLine}.
 */
export const VERDICTS = {
  allowed: { prefix: "Allowed: within your limits" },
  blocked: { prefix: "Blocked by your rule: " },
  needsOk: { prefix: "Needs your OK: " },
} as const;

export type Verdict = keyof typeof VERDICTS;

/** Line separators that would let a seller-controlled detail fake a second log line. */
const LINE_BREAKS = /[\r\n\u2028\u2029]+/g;

/**
 * Render a verdict as its one fixed user-facing line.
 * `detail` is required for blocked / needs-ok and ignored for allowed.
 */
export function verdictLine(verdict: Verdict, detail?: string): string {
  if (verdict === "allowed") return VERDICTS.allowed.prefix;
  const clean = (detail ?? "").replace(LINE_BREAKS, " ").trim();
  if (clean === "") throw new Error(`verdictLine: ${verdict} needs a non-empty detail`);
  return VERDICTS[verdict].prefix + clean;
}
