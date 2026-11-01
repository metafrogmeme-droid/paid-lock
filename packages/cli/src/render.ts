// Written with AI help.
// Text output. Every check result is one of the three verdict strings (CLAUDE.md §5 rule 6).
import type { EndpointResult, Summary } from "@paid-lock/core";

export function renderResult(r: EndpointResult, withCodes: boolean): string {
  const lines = [r.key];
  if (r.findings.length === 0) lines.push(`  ${r.line}`);
  for (const f of r.findings) lines.push(`  ${f.line}${withCodes ? ` [${f.code}]` : ""}`);
  for (const n of r.notes) lines.push(`  note: ${n}`);
  return `${lines.join("\n")}\n`;
}

export function renderSummary(s: Summary): string {
  return `\n${String(s.allowed)} allowed, ${String(s.blocked)} blocked, ${String(s.needsOk)} needed your OK\n`;
}
