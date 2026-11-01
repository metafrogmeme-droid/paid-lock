// Written with AI help.
// pnpm demo (CLAUDE.md §3 item 8): mock seller on loopback, `paid-lock add` 3 endpoints, commit the lock,
// then flip scenarios and run `paid-lock verify`. Exits non-zero on any mismatch.
//   "0 payments sent"  = the mock seller counted 0 requests carrying a payment header;
//   "0 keys loaded"    = the built CLI, probe, core and protocols contain no signing or key-loading call
//                        (scripts/lib/never-pays.ts) and no wallet dependency (pnpm check:deps runs in CI).
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseScenario, startMockSeller, type Scenario } from "../fixtures/mock-seller/src/index.ts";
import { scanText } from "./lib/never-pays.ts";

const root = resolve(import.meta.dirname, "..");
const bin = join(root, "packages/cli/dist/bin.js");
const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia (testnet) USDC, from the x402 v2 spec example
const PAY = {
  forecast: "0x0000000000000000000000000000000000001001",
  quote: "0x0000000000000000000000000000000000002002",
  news: "0x0000000000000000000000000000000000003003",
};
const SWAPPED = "0x000000000000000000000000000000000000dEaD".toLowerCase();

type Name = keyof typeof PAY;
interface Change {
  payTo?: string;
  network?: string;
  amount?: string;
  version?: string;
  raw?: { status: number; headers?: Record<string, string> };
}

function scenario(changes: Partial<Record<Name, Change>> = {}): Scenario {
  const route = (name: Name, amount: string) => {
    const c = changes[name] ?? {};
    if (c.raw !== undefined)
      return { method: "GET" as const, path: `/${name}`, respond: { kind: "raw" as const, ...c.raw } };
    return {
      method: "GET" as const,
      path: `/${name}`,
      respond: {
        kind: "x402-v2" as const,
        paymentRequired: {
          x402Version: 2,
          resource: { url: `\${origin}/${name}` },
          accepts: [
            {
              scheme: "exact",
              network: c.network ?? "eip155:84532",
              amount: c.amount ?? amount,
              asset: ASSET,
              payTo: c.payTo ?? PAY[name],
              maxTimeoutSeconds: 60,
              extra: { name: "USDC", version: c.version ?? "2" },
            },
          ],
        },
      },
    };
  };
  return parseScenario({
    _label:
      "Written with AI help, test fixture. payTo values are fake test addresses; the asset is Base Sepolia (testnet) USDC.",
    name: "demo",
    routes: [route("forecast", "10000"), route("quote", "25000"), route("news", "5000")],
  });
}

const seller = await startMockSeller({ scenario: scenario() });
const dir = mkdtempSync(join(tmpdir(), "paid-lock-demo-"));
const url = (name: Name): string => `${seller.origin}/${name}`;
const counts = { allowed: 0, blocked: 0, needsOk: 0 };
let failures = 0;

/** Run the built CLI asynchronously (the mock seller runs in this process and must keep answering). */
function cli(args: string[]): Promise<{ status: number | null; stdout: string }> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [bin, ...args],
      { cwd: dir, encoding: "utf8", env: { PATH: process.env["PATH"] ?? "" } },
      (err, stdout) => {
        done({ status: err === null ? 0 : typeof err.code === "number" ? err.code : null, stdout });
      },
    );
  });
}

async function expectVerify(step: string, target: Name | "all", exit: number, codes: string[]): Promise<void> {
  const r = await cli(["verify", ...(target === "all" ? [] : [url(target)]), "--json"]);
  const out = JSON.parse(r.stdout) as {
    results: { verdict: keyof typeof counts; line: string; findings: { code: string }[] }[];
  };
  const seen = out.results.flatMap((x) => x.findings.map((f) => f.code));
  const ok = r.status === exit && JSON.stringify(seen) === JSON.stringify(codes);
  if (!ok) failures += 1;
  for (const x of out.results) {
    counts[x.verdict] += 1;
    process.stdout.write(`${ok ? "ok  " : "FAIL"} ${step.padEnd(34)} ${x.line}\n`);
  }
  if (!ok)
    process.stdout.write(
      `     expected exit ${String(exit)} ${JSON.stringify(codes)}, got exit ${String(r.status)} ${JSON.stringify(seen)}\n`,
    );
}

try {
  process.stdout.write(`paid.lock demo: mock seller on ${seller.origin}, working in ${dir}\n\n`);
  if ((await cli(["init"])).status !== 0) throw new Error("init failed");
  for (const name of Object.keys(PAY) as Name[]) {
    const r = await cli(["add", url(name)]);
    if (r.status !== 0) throw new Error(`add ${name} failed: ${r.stdout}`);
  }
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=demo", "-c", "user.email=demo@example.invalid", "-c", "commit.gpgsign=false", ...args],
      { cwd: dir, stdio: "ignore" },
    );
  git("init", "-q");
  git("add", "paid.lock");
  git("commit", "-q", "-m", "pin 3 paid endpoints");
  process.stdout.write("pinned 3 endpoints and committed paid.lock\n\n");

  await expectVerify("1 unchanged", "all", 0, []);
  seller.use(scenario({ forecast: { payTo: SWAPPED } }));
  await expectVerify("2 payTo swapped", "forecast", 1, ["PAYTO_CHANGED"]);
  seller.use(scenario({ forecast: { network: "eip155:8453" } }));
  await expectVerify("3 network swapped", "forecast", 1, ["NETWORK_CHANGED"]);
  seller.use(scenario({ quote: { amount: "75000" } }));
  await expectVerify("4a price x3", "quote", 1, ["PRICE_ABOVE_LOCK"]);
  seller.use(scenario({ quote: { amount: "12500" } }));
  await expectVerify("4b price /2", "quote", 0, []);
  seller.use(scenario({ news: { version: "3" } }));
  await expectVerify("5 extra.version changed only", "news", 2, ["TERMS_CHANGED_OTHER"]);
  seller.use(scenario({ news: { raw: { status: 200 } } }));
  await expectVerify("6 endpoint answers 200 unpaid", "news", 2, ["ENDPOINT_NOT_402"]);
  seller.use(scenario({ news: { raw: { status: 402, headers: { "PAYMENT-REQUIRED": "not*base64*at*all" } } } }));
  await expectVerify("7 garbage header", "news", 1, ["REQUIREMENTS_UNREADABLE"]);

  const payments = seller.stats().paymentHeadersSeen;
  const shipped = ["cli", "probe", "core", "protocols"].flatMap((p) => {
    const d = join(root, "packages", p, "dist");
    return readdirSync(d, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".js"))
      .map((f) => join(d, f));
  });
  const keys = shipped.flatMap((f) => scanText(f, readFileSync(f, "utf8"))).length;
  const expected = { allowed: 4, blocked: 4, needsOk: 2 };
  if (JSON.stringify(counts) !== JSON.stringify(expected) || payments !== 0 || keys !== 0) failures += 1;
  if (failures > 0) {
    process.stdout.write(
      `\nDEMO FAILED (${String(failures)} mismatch(es); counts ${JSON.stringify(counts)}, ${String(payments)} payments sent, ${String(keys)} key or signing hits)\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `\nDEMO OK (${String(counts.allowed)} allowed, ${String(counts.blocked)} blocked, ${String(counts.needsOk)} needed your OK, ${String(payments)} payments sent, ${String(keys)} keys loaded)\n`,
    );
  }
} finally {
  await seller.close();
  rmSync(dir, { recursive: true, force: true });
}
