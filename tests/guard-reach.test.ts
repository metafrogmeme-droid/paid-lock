// Written with AI help.
import { describe, expect, it } from "vitest";
import { checkGuardReach, isAdapterFile } from "../scripts/lib/guard-reach.ts";
import { runScript } from "./run.ts";

const file = "packages/runtime/src/adapters/x.ts";

describe("guard-reach lint (every pay path in the runtime adapters reaches a paid.lock check)", () => {
  it("passes a pay-path hook that calls a check directly", () => {
    const src = `export const hooks = { onBeforePaymentCreation(ctx) { return checkAgainstLock(lock, m, u, ctx.p); } };`;
    expect(checkGuardReach(file, src)).toEqual([]);
  });

  it("passes when the check is reached through local helpers", () => {
    const src = `
      function gate(p) { return inner(p); }
      const inner = (p) => checkSelected(lock, m, u, p, s);
      export function make() { return { onBeforePaymentCreation: async (ctx) => gate(ctx) }; }`;
    expect(checkGuardReach(file, src)).toEqual([]);
  });

  it("flags a pay-path hook that never reaches a check", () => {
    const src = `export const hooks = { onBeforePaymentCreation(ctx) { return log(ctx); } };
      function log(x) { return undefined; }`;
    expect(checkGuardReach(file, src)).toEqual([
      { file, line: 1, problem: "pay path onBeforePaymentCreation does not reach a paid.lock check" },
    ]);
  });

  it("does not count a check that is only mentioned, not called", () => {
    const src = `export const hooks = { onBeforePaymentCreation: (ctx) => { const f = checkAgainstLock; return f; } };`;
    expect(checkGuardReach(file, src)).toHaveLength(1);
  });

  it("survives recursion between helpers", () => {
    const src = `function a() { return b(); } function b() { return a(); }
      export const h = { onBeforePaymentCreation() { return a(); } };`;
    expect(checkGuardReach(file, src)).toHaveLength(1);
  });

  it("flags an adapter file without any known pay path, so a new adapter cannot skip the lint", () => {
    expect(checkGuardReach(file, `export function payNow() { return 1; }`)).toEqual([
      { file, line: 1, problem: "no pay path found (add the hook name to PAY_PATHS in scripts/lib/guard-reach.ts)" },
    ]);
  });

  it("covers the adapter sources only", () => {
    expect(isAdapterFile("packages/runtime/src/adapters/x402-client.ts")).toBe(true);
    expect(isAdapterFile("packages/runtime/src/adapters/x402-client.test.ts")).toBe(false);
    expect(isAdapterFile("packages/runtime/src/check.ts")).toBe(false);
  });

  it("passes on this repo's adapters", () => {
    const r = runScript("scripts/check-guard-reach.ts", []);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^guard-reach: OK \(\d+ adapter file/u);
  });
});
