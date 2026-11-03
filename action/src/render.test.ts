import type { EndpointResult, Summary } from "@paid-lock/core";
import { describe, expect, it } from "vitest";
import {
  escapeCommandData,
  escapeCommandProperty,
  escapeLog,
  escapeMarkdown,
  lineOfKey,
  renderSarif,
  renderSummaryMarkdown,
} from "./render.ts";

const KEY = "GET https://api.example.com/v1/forecast";
const blocked: EndpointResult = {
  key: KEY,
  verdict: "blocked",
  line: "Blocked by your rule: payTo changed since paid.lock (0xA -> 0xB)",
  findings: [
    {
      code: "PAYTO_CHANGED",
      verdict: "blocked",
      line: "Blocked by your rule: payTo changed since paid.lock (0xA -> 0xB)",
      option: "exact eip155:84532 0xT 0xA",
    },
    {
      code: "TERMS_CHANGED_OTHER",
      verdict: "needsOk",
      line: "Needs your OK: other payment terms changed since paid.lock (changed: extra)",
    },
  ],
  notes: [],
};
const allowed: EndpointResult = {
  key: "GET https://b.example/x",
  verdict: "allowed",
  line: "Allowed: within your limits",
  findings: [],
  notes: ["price dropped for x (2 -> 1)"],
};
const summary: Summary = { verdict: "blocked", allowed: 1, blocked: 1, needsOk: 0 };
const LOCK = `{\n  "endpoints": {\n    "GET https://b.example/x": {\n    },\n    "${KEY}": {\n    }\n  }\n}\n`;

describe("escaping seller-controlled text", () => {
  it("neutralises Markdown and HTML (no injected links, images or tags in the job summary)", () => {
    const evil = "[click](https://evil.example) ![x](y) <img src=x> | `code` *b* _i_ #h";
    const out = escapeMarkdown(evil);
    expect(out).not.toMatch(/(?<!\\)[[\]()<>|`*_#!]/);
    expect(out).toContain("&lt;img");
  });

  it("escapes workflow command data and properties (no injected ::commands)", () => {
    expect(escapeCommandData("50%\r\n::stop-commands::x")).toBe("50%25%0D%0A::stop-commands::x");
    expect(escapeCommandProperty("a:b,c%\n")).toBe("a%3Ab%2Cc%25%0A");
  });
});

describe("lineOfKey", () => {
  it("finds the 1-based line of an endpoint key in the lock text", () => {
    expect(lineOfKey(LOCK, KEY)).toBe(5);
    expect(lineOfKey(LOCK, "GET https://b.example/x")).toBe(3);
    expect(lineOfKey(LOCK, "GET https://missing.example/")).toBe(1);
  });
});

describe("renderSummaryMarkdown", () => {
  it("lists every endpoint with its verdict lines, notes and the counts", () => {
    const md = renderSummaryMarkdown([blocked, allowed], summary, "paid.lock");
    expect(md).toContain("## paid.lock");
    expect(md).toContain("1 allowed, 1 blocked, 0 needed your OK");
    expect(md).toContain(escapeMarkdown("Blocked by your rule: payTo changed since paid.lock (0xA -> 0xB)"));
    expect(md).toContain("0xA \\-&gt; 0xB");
    expect(md).toContain("`PAYTO_CHANGED`");
    expect(md).toContain("note: price dropped");
    expect(md).toContain("never pays");
  });
});

describe("renderSarif", () => {
  const sarif = renderSarif([blocked, allowed], "paid.lock", LOCK, "0.0.0") as {
    version: string;
    runs: {
      tool: { driver: { name: string; rules: { id: string }[] } };
      results: {
        ruleId: string;
        level: string;
        message: { text: string };
        locations: { physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } } }[];
        partialFingerprints: Record<string, string>;
      }[];
    }[];
  };

  it("is SARIF 2.1.0 with one result per finding, anchored to the endpoint's line in the lock", () => {
    expect(sarif.version).toBe("2.1.0");
    const run = sarif.runs[0];
    expect(run?.tool.driver.name).toBe("paid-lock");
    expect(run?.results.map((r) => [r.ruleId, r.level])).toEqual([
      ["PAYTO_CHANGED", "error"],
      ["TERMS_CHANGED_OTHER", "warning"],
    ]);
    expect(run?.results[0]?.locations[0]?.physicalLocation).toEqual({
      artifactLocation: { uri: "paid.lock" },
      region: { startLine: 5 },
    });
    expect(run?.tool.driver.rules.map((r) => r.id).sort()).toEqual(["PAYTO_CHANGED", "TERMS_CHANGED_OTHER"]);
  });

  it("gives stable fingerprints so code scanning tracks the same finding across runs", () => {
    const again = renderSarif([blocked], "paid.lock", LOCK, "0.0.0") as typeof sarif;
    expect(again.runs[0]?.results[0]?.partialFingerprints).toEqual(sarif.runs[0]?.results[0]?.partialFingerprints);
    expect(sarif.runs[0]?.results[0]?.partialFingerprints).not.toEqual(sarif.runs[0]?.results[1]?.partialFingerprints);
  });

  it("has no results when everything is allowed", () => {
    expect((renderSarif([allowed], "paid.lock", LOCK, "0.0.0") as typeof sarif).runs[0]?.results).toEqual([]);
  });
});

describe("seller text cannot mention people or forge workflow commands (audit L2)", () => {
  it("breaks @mentions in Markdown so a seller's payTo cannot notify a user or team", () => {
    const out = escapeMarkdown("payTo changed (A -> @octocat)");
    expect(out).not.toMatch(/@[a-z]/u);
    expect(out).toContain("@&#8203;octocat");
  });

  it("breaks the legacy ##[ command syntax in log lines and annotation messages", () => {
    const evil = "(A -> x##[set-output name=verdict;]allowed)";
    expect(escapeLog(evil)).not.toContain("##[");
    expect(escapeCommandData(evil)).not.toContain("##[");
  });
});
