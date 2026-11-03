import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isShippedCode, scanText } from "../scripts/lib/never-pays.ts";
import { runScript } from "./run.ts";

// Assembled at run time: these names must not appear literally outside the scanner and the mock seller.
const V2 = "PAYMENT-" + "SIGNATURE";
const V1 = "X-" + "PAYMENT";

describe("never-pays source scan", () => {
  it.each([
    [`headers.set("${V2}", x)`, "x402-v2-payment-header"],
    [`{ "${V1.toLowerCase()}": x }`, "x402-v1-payment-header"],
    [`{ authorization: "Payment " + c }`, "mpp-payment-credential"],
    [`fetch(base + "/settle")`, "facilitator-call"],
    [`await account.signTypedData(msg)`, "signing-call"],
    [`privateKeyToAccount(k)`, "signing-call"],
  ])("flags %j", (line, id) => {
    expect(scanText("packages/probe/src/a.ts", line).map((h) => h.id)).toEqual([id]);
  });

  it.each([
    `const h = res.headers.get("PAYMENT-REQUIRED")`,
    `// reads ${V1}-RESPONSE never`,
    `{ authorization: "Bearer x" }`,
    `paid-lock verify`,
  ])("does not flag %j", (line) => {
    expect(scanText("packages/probe/src/a.ts", line)).toEqual([]);
  });

  it("covers package sources and the action, not tests or fixtures", () => {
    expect(isShippedCode("packages/probe/src/probe.ts")).toBe(true);
    expect(isShippedCode("packages/probe/src/probe.test.ts")).toBe(false);
    expect(isShippedCode("action/dist/index.js")).toBe(true);
    expect(isShippedCode("fixtures/mock-seller/src/server.ts")).toBe(false);
    expect(isShippedCode("packages/core/src/__fixtures__/terms.ts")).toBe(false);
  });

  const dir = mkdtempSync(join(tmpdir(), "never-pays-"));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("CLI fails on a planted payment header", () => {
    const planted = join(dir, "planted.ts");
    writeFileSync(planted, `await fetch(u, { headers: { "${V2}": "x" } });\n`);
    const r = runScript("scripts/check-never-pays.ts", [planted]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("x402-v2-payment-header");
  });

  it("CLI passes the real shipped code", () => {
    const r = runScript("scripts/check-never-pays.ts", []);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
