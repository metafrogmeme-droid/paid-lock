// Written with AI help.
import { parseScenario, startMockSeller, type MockSeller } from "@paid-lock/mock-seller";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main as cli } from "paid-lock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAction } from "./run.ts";

const PAY_A = "0x0000000000000000000000000000000000001001";
const PAY_B = "0x0000000000000000000000000000000000002002";
const scenario = (payTo: string) =>
  parseScenario({
    _label: "Written with AI help, test fixture. Fake payTo; asset is Base Sepolia (testnet) USDC.",
    name: "action",
    routes: [
      {
        method: "GET",
        path: "/a",
        respond: {
          kind: "x402-v2",
          paymentRequired: {
            x402Version: 2,
            resource: { url: "${origin}/a" },
            accepts: [
              {
                scheme: "exact",
                network: "eip155:84532",
                amount: "10000",
                asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
                payTo,
                maxTimeoutSeconds: 60,
              },
            ],
          },
        },
      },
    ],
  });

let seller: MockSeller;
let dir: string;
beforeAll(async () => {
  seller = await startMockSeller({ scenario: scenario(PAY_A) });
});
afterAll(async () => {
  expect(seller.stats().paymentHeadersSeen).toBe(0);
  await seller.close();
});
beforeEach(async () => {
  seller.use(scenario(PAY_A));
  dir = mkdtempSync(join(tmpdir(), "paid-lock-action-"));
  const quiet = { out: () => undefined, err: () => undefined, isTTY: false, prompt: () => Promise.resolve("") };
  const lockfile = join(dir, "paid.lock");
  expect(await cli(["init", "--lockfile", lockfile], quiet)).toBe(0);
  expect(await cli(["add", `${seller.origin}/a`, "--allow-private-network", "--lockfile", lockfile], quiet)).toBe(0);
  writeFileSync(join(dir, "summary.md"), "");
  writeFileSync(join(dir, "output.txt"), "");
  return () => {
    rmSync(dir, { recursive: true, force: true });
  };
});

function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    INPUT_LOCKFILE: "paid.lock",
    "INPUT_FAIL-ON": "needs-ok",
    INPUT_SARIF: "paid-lock.sarif",
    GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
    GITHUB_OUTPUT: join(dir, "output.txt"),
    ...extra,
  };
}

function capture(): { log: (s: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { log: (s) => lines.push(s), lines };
}

describe("runAction against the mock seller", () => {
  it("passes when nothing changed, and writes summary, SARIF and outputs", async () => {
    const c = capture();
    expect(await runAction(env(), dir, c.log)).toBe(0);
    expect(readFileSync(join(dir, "summary.md"), "utf8")).toContain("1 allowed, 0 blocked, 0 needed your OK");
    const sarif = JSON.parse(readFileSync(join(dir, "paid-lock.sarif"), "utf8")) as { runs: { results: unknown[] }[] };
    expect(sarif.runs[0]?.results).toEqual([]);
    const outputs = readFileSync(join(dir, "output.txt"), "utf8");
    expect(outputs).toContain("verdict=allowed\n");
    expect(outputs).toContain("blocked=0\n");
    expect(c.lines.join("\n")).toContain("Allowed: within your limits");
  });

  it("fails on a payTo swap with an error annotation on the lock entry", async () => {
    seller.use(scenario(PAY_B));
    const c = capture();
    expect(await runAction(env(), dir, c.log)).toBe(1);
    expect(
      c.lines.find((l) => l.startsWith("::error file=paid.lock,line=3,title=paid-lock PAYTO_CHANGED::")),
    ).toBeDefined();
    const sarif = JSON.parse(readFileSync(join(dir, "paid-lock.sarif"), "utf8")) as {
      runs: { results: { ruleId: string }[] }[];
    };
    expect(sarif.runs[0]?.results.map((r) => r.ruleId)).toEqual(["PAYTO_CHANGED"]);
    expect(readFileSync(join(dir, "output.txt"), "utf8")).toContain("verdict=blocked\n");
  });

  it("skips SARIF when the input is empty", async () => {
    expect(await runAction(env({ INPUT_SARIF: "" }), dir, () => undefined)).toBe(0);
    expect(() => readFileSync(join(dir, "paid-lock.sarif"))).toThrow();
  });

  it("fails with a tool error on a bad input, a missing lock or an invalid lock", async () => {
    const c = capture();
    expect(await runAction(env({ "INPUT_FAIL-ON": "never" }), dir, c.log)).toBe(3);
    expect(c.lines.join("\n")).toContain("::error::paid-lock: fail-on must be needs-ok or blocked");
    expect(await runAction(env({ INPUT_LOCKFILE: "missing.lock" }), dir, () => undefined)).toBe(3);
    expect(readFileSync(join(dir, "output.txt"), "utf8")).toContain("verdict=error\n");
    writeFileSync(join(dir, "paid.lock"), "{}");
    expect(await runAction(env(), dir, () => undefined)).toBe(3);
  });

  it("rejects a comment input that is not true or false", async () => {
    const c = capture();
    expect(await runAction(env({ INPUT_COMMENT: "yes" }), dir, c.log)).toBe(3);
    expect(c.lines.join("\n")).toContain("comment must be true or false");
  });

  it("with comment: true outside a pull request, skips the comment and keeps the verdict", async () => {
    const c = capture();
    expect(
      await runAction(env({ INPUT_COMMENT: "true", "INPUT_GITHUB-TOKEN": "t", GITHUB_EVENT_NAME: "push" }), dir, c.log),
    ).toBe(0);
    expect(c.lines.join("\n")).toContain("::notice::paid-lock: no PR comment");
  });

  it("refuses a lock file outside the workspace", async () => {
    const c = capture();
    expect(await runAction(env({ INPUT_LOCKFILE: "../../etc/passwd" }), dir, c.log)).toBe(3);
    expect(c.lines.join("\n")).toContain("inside the workspace");
  });

  it("works without GITHUB_STEP_SUMMARY and GITHUB_OUTPUT (local run)", async () => {
    const e = env();
    delete e["GITHUB_STEP_SUMMARY"];
    delete e["GITHUB_OUTPUT"];
    expect(await runAction(e, dir, () => undefined)).toBe(0);
  });
});
