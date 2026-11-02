// Written with AI help.
// Helper for the Action self-test job in CI (.github/workflows/ci.yml, job action-selftest).
// Keeps a mock seller running on 127.0.0.1:4021 across workflow steps and checks, every time it
// stops one, that the seller saw 0 payment headers.
//   node scripts/action-selftest.ts setup            serve "unchanged" and pin /forecast in .ci/action-selftest/paid.lock
//   node scripts/action-selftest.ts serve <variant>  restart the seller with a variant (see FORECAST_VARIANTS)
//   node scripts/action-selftest.ts stop             stop the seller
// Needs `pnpm build` first (it runs the built paid-lock binary).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { demoScenario, FORECAST_VARIANTS } from "../fixtures/mock-seller/src/demo-scenarios.ts";

const root = resolve(import.meta.dirname, "..");
const dir = join(root, ".ci", "action-selftest");
const pidFile = join(dir, "seller.pid");
const origin = "http://127.0.0.1:4021";

function fail(message: string): never {
  process.stderr.write(`action-selftest: ${message}\n`);
  process.exit(1);
}

async function stats(): Promise<{ paymentHeadersSeen: number } | undefined> {
  try {
    // Plain http on purpose: the mock seller runs on loopback inside the CI job.
    // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
    return (await (await fetch(`${origin}/__mock/stats`)).json()) as { paymentHeadersSeen: number };
  } catch {
    return undefined;
  }
}

async function stop(): Promise<void> {
  if (!existsSync(pidFile)) return;
  const s = await stats();
  if (s !== undefined && s.paymentHeadersSeen !== 0)
    fail(`the mock seller saw ${String(s.paymentHeadersSeen)} payment header(s)`);
  try {
    process.kill(Number(readFileSync(pidFile, "utf8")), "SIGTERM");
  } catch {
    // already gone
  }
  rmSync(pidFile);
  for (let i = 0; i < 50 && (await stats()) !== undefined; i += 1) await new Promise((r) => setTimeout(r, 100));
  process.stdout.write("action-selftest: seller stopped (0 payment headers seen)\n");
}

async function serve(variant: string): Promise<void> {
  if (!Object.hasOwn(FORECAST_VARIANTS, variant)) fail(`unknown variant "${variant}"`);
  await stop();
  mkdirSync(dir, { recursive: true });
  const change = FORECAST_VARIANTS[variant];
  const file = join(dir, `${variant}.json`);
  writeFileSync(file, JSON.stringify(demoScenario(change === undefined ? {} : { forecast: change })));
  const log = openSync(join(dir, "seller.log"), "a");
  const child = spawn(process.execPath, [join(root, "fixtures/mock-seller/src/main.ts"), file, "--port", "4021"], {
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  for (let i = 0; i < 100; i += 1) {
    if ((await stats()) !== undefined) {
      process.stdout.write(`action-selftest: serving "${variant}" on ${origin}\n`);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  fail("the mock seller did not start");
}

const [command, arg] = process.argv.slice(2);
if (command === "setup") {
  await serve("unchanged");
  const lockfile = join(dir, "paid.lock");
  rmSync(lockfile, { force: true });
  const cli = (...args: string[]) =>
    execFileSync(process.execPath, [join(root, "packages/cli/dist/bin.js"), ...args, "--lockfile", lockfile], {
      stdio: "inherit",
    });
  cli("init");
  cli("add", `${origin}/forecast`, "--allow-private-network");
} else if (command === "serve" && arg !== undefined) {
  await serve(arg);
} else if (command === "stop") {
  await stop();
} else {
  fail("usage: action-selftest.ts setup | serve <variant> | stop");
}
