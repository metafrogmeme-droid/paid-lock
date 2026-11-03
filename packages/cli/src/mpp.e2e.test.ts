// Written with AI help.
// M5 acceptance (CLAUDE.md §6): MPP fixtures through the real CLI and probe against the loopback mock
// seller. Recipient, currency and amount changes are caught; id, expires and opaque, fresh on every
// response, are ignored (two samples per verify must agree). The mock seller sees no payment header.
import { MPP_VARIANTS, mppScenario, startMockSeller, type MockSeller } from "@paid-lock/mock-seller";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXIT, main, type Io } from "./main.ts";

let seller: MockSeller;
let dir: string;
let lockfile: string;

function io(): Io & { text: () => string } {
  const out: string[] = [];
  return {
    out: (s) => out.push(s),
    err: (s) => out.push(s),
    isTTY: false,
    prompt: () => Promise.resolve(""),
    text: () => out.join(""),
  };
}
const run = (args: string[], i = io()) => main([...args, "--lockfile", lockfile], i);

beforeAll(async () => {
  seller = await startMockSeller({ scenario: mppScenario() });
  dir = mkdtempSync(join(tmpdir(), "paid-lock-mpp-"));
  lockfile = join(dir, "paid.lock");
  expect(await run(["init"])).toBe(EXIT.allowed);
  expect(await run(["add", `${seller.origin}/mpp`, "--allow-private-network"])).toBe(EXIT.allowed);
});

afterAll(async () => {
  const stats = seller.stats();
  await seller.close();
  rmSync(dir, { recursive: true, force: true });
  expect(stats.paymentHeadersSeen).toBe(0);
});

describe("MPP endpoints through the CLI (M5 acceptance)", () => {
  it("pins both challenges as MPP options and keeps no per-challenge field", () => {
    const lock = readFileSync(lockfile, "utf8");
    expect(lock).toContain('"protocol": "mpp"');
    expect(lock).toContain("mpp:tempo");
    expect(lock).toContain("mpp:stripe");
    expect(lock).toContain("realm:seller.test");
    for (const perChallenge of ["opaque", "expires", '"id"']) expect(lock).not.toContain(perChallenge);
  });

  it.each(Object.keys(MPP_VARIANTS))("%s", async (name) => {
    const variant = MPP_VARIANTS[name];
    if (variant === undefined) throw new Error(name);
    seller.use(mppScenario(variant.change));
    const i = io();
    const code = await run(["verify", "--json"], i);
    const out = JSON.parse(i.text()) as { results: { verdict: string; findings: { code: string; tag?: string }[] }[] };
    const [verdict, first] = variant.expect;
    expect(out.results[0]?.verdict).toBe(verdict);
    expect(out.results[0]?.findings[0]?.code ?? "OK").toBe(first);
    // Fresh id/expires/opaque on each of the two samples never look like unstable terms.
    expect(out.results[0]?.findings.some((f) => f.tag === "unstable-samples")).toBe(false);
    expect(code).toBe(verdict === "allowed" ? EXIT.allowed : verdict === "blocked" ? EXIT.blocked : EXIT.needsOk);
  });
});
