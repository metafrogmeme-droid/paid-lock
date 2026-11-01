// Written with AI help.
import { parseScenario, startMockSeller, type MockSeller } from "@paid-lock/mock-seller";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EXIT, main, type Io } from "./main.ts";

const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PAY_A = "0x0000000000000000000000000000000000001001";
const PAY_B = "0x0000000000000000000000000000000000002002";

interface Opt {
  payTo?: string;
  amount?: string;
  network?: string;
  version?: string;
}
function v2(path: string, o: Opt = {}) {
  return {
    method: "GET" as const,
    path,
    respond: {
      kind: "x402-v2" as const,
      paymentRequired: {
        x402Version: 2,
        resource: { url: `\${origin}${path}` },
        accepts: [
          {
            scheme: "exact",
            network: o.network ?? "eip155:84532",
            amount: o.amount ?? "10000",
            asset: ASSET,
            payTo: o.payTo ?? PAY_A,
            maxTimeoutSeconds: 60,
            extra: { name: "USDC", version: o.version ?? "2" },
          },
        ],
      },
    },
  };
}
function scenario(a: Opt = {}) {
  return parseScenario({
    _label: "Written with AI help, test fixture. Fake payTo addresses; asset is Base Sepolia (testnet) USDC.",
    name: "cli",
    routes: [
      v2("/a", a),
      v2("/b"),
      { method: "GET", path: "/free", respond: { kind: "raw", status: 200 } },
      {
        method: "GET",
        path: "/garbage",
        respond: { kind: "raw", status: 402, headers: { "PAYMENT-REQUIRED": "%%%" } },
      },
    ],
  });
}

let seller: MockSeller;
let dir: string;
let lockfile: string;
beforeAll(async () => {
  seller = await startMockSeller({ scenario: scenario() });
});
afterAll(async () => {
  expect(seller.stats().paymentHeadersSeen).toBe(0);
  await seller.close();
});
beforeEach(() => {
  seller.use(scenario());
  dir = mkdtempSync(join(tmpdir(), "paid-lock-cli-"));
  lockfile = join(dir, "paid.lock");
  return () => {
    rmSync(dir, { recursive: true, force: true });
  };
});

function io(opts: { tty?: boolean; answer?: string } = {}): Io & { text: () => string; errText: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    isTTY: opts.tty ?? false,
    prompt: () => Promise.resolve(opts.answer ?? ""),
    text: () => out.join(""),
    errText: () => err.join(""),
  };
}
const run = (args: string[], i = io()) => main([...args, "--lockfile", lockfile], i);
const url = (p: string) => `${seller.origin}${p}`;
const readLock = () => readFileSync(lockfile, "utf8");

async function initAndAdd(...paths: string[]): Promise<void> {
  expect(await run(["init"])).toBe(EXIT.allowed);
  for (const p of paths) expect(await run(["add", url(p)])).toBe(EXIT.allowed);
}

describe("basics", () => {
  it("prints version and help, and rejects unknown commands and options", async () => {
    const i = io();
    expect(await main(["--version"], i)).toBe(EXIT.allowed);
    expect(i.text()).toMatch(/^paid-lock \d+\.\d+\.\d+/);
    expect(await main([], i)).toBe(EXIT.allowed);
    expect(i.text()).toContain("Usage: paid-lock");
    expect(await main(["frobnicate"], i)).toBe(EXIT.toolError);
    expect(await main(["verify", "--frob"], i)).toBe(EXIT.toolError);
  });

  it("keeps the documented exit codes", () => {
    expect(EXIT).toEqual({ allowed: 0, blocked: 1, needsOk: 2, toolError: 3 });
  });
});

describe("init", () => {
  it("creates an empty lock and refuses to overwrite one", async () => {
    expect(await run(["init"])).toBe(EXIT.allowed);
    expect(readLock()).toBe('{\n  "endpoints": {},\n  "lockfileVersion": 1\n}\n');
    const i = io();
    expect(await run(["init"], i)).toBe(EXIT.toolError);
    expect(i.errText()).toContain("already exists");
  });
});

describe("add", () => {
  it("pins an endpoint's observed terms and the owner's policy", async () => {
    await initAndAdd("/a");
    const lock = JSON.parse(readLock()) as {
      endpoints: Record<string, { policy: { options: Record<string, { maxAmount: string }> } }>;
    };
    const ep = lock.endpoints[`GET ${url("/a")}`];
    expect(Object.values(ep?.policy.options ?? {})).toEqual([{ maxAmount: "10000" }]);
  });

  it("applies --tolerance to the policy cap", async () => {
    await run(["init"]);
    expect(await run(["add", url("/a"), "--tolerance", "10%"])).toBe(EXIT.allowed);
    expect(readLock()).toContain('"maxAmount": "11000"');
  });

  it.each(["abc", "-1%", "101%", "1.5%"])("refuses the tolerance %s", async (t) => {
    await run(["init"]);
    expect(await run(["add", url("/a"), "--tolerance", t])).toBe(EXIT.toolError);
  });

  it("refuses an endpoint that is already pinned", async () => {
    await initAndAdd("/a");
    const i = io();
    expect(await run(["add", url("/a")], i)).toBe(EXIT.toolError);
    expect(i.errText()).toContain("paid-lock update");
  });

  it("does not pin an endpoint that answers 200 unpaid (needs your OK)", async () => {
    await run(["init"]);
    const before = readLock();
    const i = io();
    expect(await run(["add", url("/free")], i)).toBe(EXIT.needsOk);
    expect(i.text()).toContain("Needs your OK: endpoint did not answer 402 without payment (HTTP 200)");
    expect(readLock()).toBe(before);
  });

  it("does not pin unreadable terms (blocked)", async () => {
    await run(["init"]);
    expect(await run(["add", url("/garbage")])).toBe(EXIT.blocked);
  });

  it("needs an existing lock and an allowed URL", async () => {
    expect(await run(["add", url("/a")])).toBe(EXIT.toolError);
    await run(["init"]);
    expect(await run(["add", "http://api.example.com/x"])).toBe(EXIT.toolError);
    expect(await run(["add"])).toBe(EXIT.toolError);
  });
});

describe("verify", () => {
  it("allows unchanged terms", async () => {
    await initAndAdd("/a", "/b");
    const i = io();
    expect(await run(["verify"], i)).toBe(EXIT.allowed);
    expect(i.text()).toContain("Allowed: within your limits");
    expect(i.text()).toContain("2 allowed, 0 blocked, 0 needed your OK");
  });

  it("blocks a payTo swap", async () => {
    await initAndAdd("/a", "/b");
    seller.use(scenario({ payTo: PAY_B }));
    const i = io();
    expect(await run(["verify"], i)).toBe(EXIT.blocked);
    expect(i.text()).toContain(`Blocked by your rule: payTo changed since paid.lock (${PAY_A} -> ${PAY_B})`);
  });

  it("needs your OK for an extra.version change; --fail-on blocked does not fail on it", async () => {
    await initAndAdd("/a");
    seller.use(scenario({ version: "3" }));
    expect(await run(["verify"])).toBe(EXIT.needsOk);
    expect(await run(["verify", "--fail-on", "blocked"])).toBe(EXIT.allowed);
    expect(await run(["verify", "--fail-on", "sometimes"])).toBe(EXIT.toolError);
  });

  it("allows a price drop and reports it", async () => {
    await initAndAdd("/a");
    seller.use(scenario({ amount: "5000" }));
    const i = io();
    expect(await run(["verify"], i)).toBe(EXIT.allowed);
    expect(i.text()).toContain("note: price dropped");
  });

  it("verifies one URL, and blocks one that is not in the lock", async () => {
    await initAndAdd("/a");
    expect(await run(["verify", url("/a")])).toBe(EXIT.allowed);
    const i = io();
    expect(await run(["verify", url("/b")], i)).toBe(EXIT.blocked);
    expect(i.text()).toContain("Blocked by your rule: endpoint is not in paid.lock");
  });

  it("prints JSON with --json", async () => {
    await initAndAdd("/a");
    seller.use(scenario({ payTo: PAY_B }));
    const i = io();
    expect(await run(["verify", "--json"], i)).toBe(EXIT.blocked);
    const out = JSON.parse(i.text()) as {
      summary: { verdict: string; blocked: number };
      results: { findings: { code: string }[] }[];
    };
    expect(out.summary).toMatchObject({ verdict: "blocked", blocked: 1 });
    expect(out.results[0]?.findings.map((f) => f.code)).toEqual(["PAYTO_CHANGED"]);
  });

  it("is a tool error when the lock is missing or invalid", async () => {
    expect(await run(["verify"])).toBe(EXIT.toolError);
    writeFileSync(lockfile, '{"lockfileVersion":1,"endpoints":{},"lockedAt":"x"}');
    const i = io();
    expect(await run(["verify"], i)).toBe(EXIT.toolError);
    expect(i.errText()).toContain("paid.lock is invalid");
  });
});

describe("diff", () => {
  it("shows changes and exits 0", async () => {
    await initAndAdd("/a");
    seller.use(scenario({ payTo: PAY_B }));
    const i = io();
    expect(await run(["diff"], i)).toBe(EXIT.allowed);
    expect(i.text()).toContain("PAYTO_CHANGED");
  });
});

describe("update", () => {
  it("refuses non-interactively without --accept-change for every code, and leaves the lock alone", async () => {
    await initAndAdd("/a");
    const before = readLock();
    seller.use(scenario({ payTo: PAY_B }));
    const i = io();
    expect(await run(["update", url("/a")], i)).toBe(EXIT.blocked);
    expect(i.errText()).toContain("--accept-change PAYTO_CHANGED");
    expect(await run(["update", url("/a"), "--accept-change", "TERMS_CHANGED_OTHER"])).toBe(EXIT.blocked);
    expect(readLock()).toBe(before);
  });

  it("accepts a reviewed change with --accept-change, after which verify allows it", async () => {
    await initAndAdd("/a");
    seller.use(scenario({ payTo: PAY_B }));
    expect(await run(["update", url("/a"), "--accept-change", "PAYTO_CHANGED"])).toBe(EXIT.allowed);
    expect(readLock()).toContain(PAY_B);
    expect(await run(["verify"])).toBe(EXIT.allowed);
  });

  it("asks for a typed yes on a TTY", async () => {
    await initAndAdd("/a");
    seller.use(scenario({ version: "3" }));
    expect(await run(["update", url("/a")], io({ tty: true, answer: "no" }))).toBe(EXIT.needsOk);
    expect(await run(["update", url("/a")], io({ tty: true, answer: "yes" }))).toBe(EXIT.allowed);
    expect(await run(["verify"])).toBe(EXIT.allowed);
  });

  it("keeps the owner's policy when accepting (only observed is rewritten)", async () => {
    await run(["init"]);
    await run(["add", url("/a"), "--tolerance", "10%"]);
    seller.use(scenario({ version: "3" }));
    await run(["update", url("/a"), "--accept-change", "TERMS_CHANGED_OTHER"]);
    expect(readLock()).toContain('"maxAmount": "11000"');
    expect(readLock()).toContain('"version": "3"');
  });

  it("updates every endpoint with --all and leaves an unchanged lock byte-identical", async () => {
    await initAndAdd("/a", "/b");
    const before = readLock();
    const i = io();
    expect(await run(["update", "--all"], i)).toBe(EXIT.allowed);
    expect(i.text()).toContain("no change");
    expect(readLock()).toBe(before);
  });

  it("cannot accept unreadable terms or an endpoint that is not pinned", async () => {
    await initAndAdd("/a");
    seller.use(
      parseScenario({
        _label: "Written with AI help, test fixture.",
        name: "broken",
        routes: [
          { method: "GET", path: "/a", respond: { kind: "raw", status: 402, headers: { "PAYMENT-REQUIRED": "%%%" } } },
        ],
      }),
    );
    expect(await run(["update", url("/a"), "--accept-change", "REQUIREMENTS_UNREADABLE"])).toBe(EXIT.blocked);
    expect(await run(["update", url("/b")])).toBe(EXIT.toolError);
    expect(await run(["update"])).toBe(EXIT.toolError);
  });
});

describe("explain", () => {
  it("explains a code with its verdict line", async () => {
    const i = io();
    expect(await main(["explain", "PAYTO_CHANGED"], i)).toBe(EXIT.allowed);
    expect(i.text()).toContain("Blocked by your rule: payTo changed since paid.lock");
  });

  it("fails on an unknown code", async () => {
    expect(await main(["explain", "NOPE"], io())).toBe(EXIT.toolError);
    expect(await main(["explain"], io())).toBe(EXIT.toolError);
  });
});
