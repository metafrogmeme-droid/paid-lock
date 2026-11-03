// Output of the GitHub Action: job summary (Markdown), SARIF 2.1.0 and workflow-command annotations.
// Text from sellers (verdict details) is escaped for each format: no injected Markdown links, HTML
// or workflow commands. Every check line stays one of the three verdict strings.
import { decode, integrityOf, type EndpointResult, type ReasonCode, type Summary } from "@paid-lock/core";
import { EXPLAIN } from "paid-lock";

const MD_SPECIAL = /[\\`*_{}[\]()#+\-.!|~]/g;

/** Escape text for GitHub-flavoured Markdown: HTML entities, then backslash-escape ASCII punctuation. */
export function escapeMarkdown(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(MD_SPECIAL, (c) => `\\${c}`);
}

/** Workflow command message (actions/toolkit escapeData). */
export function escapeCommandData(text: string): string {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/** Workflow command property (actions/toolkit escapeProperty). */
export function escapeCommandProperty(text: string): string {
  return escapeCommandData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

/** 1-based line of an endpoint's key in the lock text (1 if not found), so annotations point at the entry. */
export function lineOfKey(lockText: string, key: string): number {
  const needle = `${JSON.stringify(key)}:`;
  const index = lockText.split("\n").findIndex((l) => l.trimStart().startsWith(needle));
  return index < 0 ? 1 : index + 1;
}

export function renderSummaryMarkdown(results: readonly EndpointResult[], summary: Summary, lockfile: string): string {
  const out = [
    `## paid.lock: ${String(summary.allowed)} allowed, ${String(summary.blocked)} blocked, ${String(summary.needsOk)} needed your OK`,
    "",
    "| Endpoint | Result |",
    "| --- | --- |",
  ];
  for (const r of results) {
    const lines =
      r.findings.length === 0
        ? [escapeMarkdown(r.line)]
        : r.findings.map((f) => `${escapeMarkdown(f.line)} \`${f.code}\``);
    for (const n of r.notes) lines.push(`note: ${escapeMarkdown(n)}`);
    out.push(`| ${escapeMarkdown(r.key)} | ${lines.join("<br>")} |`);
  }
  out.push(
    "",
    `Checked against \`${escapeMarkdown(lockfile)}\` with unpaid requests. paid-lock never pays, never signs and never loads a key.`,
    "",
  );
  return out.join("\n");
}

export function renderSarif(
  results: readonly EndpointResult[],
  lockfile: string,
  lockText: string,
  version: string,
): object {
  const codes = new Set<ReasonCode>();
  const sarifResults = results.flatMap((r) =>
    r.findings.map((f) => {
      codes.add(f.code);
      return {
        ruleId: f.code,
        level: f.verdict === "blocked" ? "error" : "warning",
        message: { text: f.line },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: lockfile },
              region: { startLine: lineOfKey(lockText, r.key) },
            },
          },
        ],
        partialFingerprints: { "paidLock/v1": integrityOf({ key: r.key, code: f.code, option: f.option ?? null }) },
      };
    }),
  );
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "paid-lock",
            version,
            rules: [...codes].sort().map((id) => ({
              id,
              shortDescription: { text: decode(id) },
              fullDescription: { text: EXPLAIN[id] },
              defaultConfiguration: { level: decode(id).startsWith("Blocked") ? "error" : "warning" },
            })),
          },
        },
        results: sarifResults,
      },
    ],
  };
}

/** One `::error` / `::warning` workflow command per finding, pointing at the endpoint's line in the lock. */
export function renderAnnotations(results: readonly EndpointResult[], lockfile: string, lockText: string): string[] {
  return results.flatMap((r) =>
    r.findings.map(
      (f) =>
        `::${f.verdict === "blocked" ? "error" : "warning"} file=${escapeCommandProperty(lockfile)},line=${String(lineOfKey(lockText, r.key))},title=${escapeCommandProperty(`paid-lock ${f.code}`)}::${escapeCommandData(`${r.key}: ${f.line}`)}`,
    ),
  );
}
