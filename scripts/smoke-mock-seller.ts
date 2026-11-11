// Out-of-process smoke test of the mock seller CLI (M1 acceptance): start it on loopback, read one
// 402, check the PAYMENT-REQUIRED header decodes to x402 v2 JSON, stop it, and require that it
// exited 0 (it exits 1 if it ever saw a payment header) and reported 0 payment headers.
// It stops the seller by closing its stdin (--stop-on-stdin-end), not with SIGTERM: on Windows a
// child's SIGTERM is a hard terminate, so the seller could not report. Usage: node scripts/smoke-mock-seller.ts
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const root = resolve(import.meta.dirname, "..");
const child = spawn(process.execPath, [resolve(root, "fixtures/mock-seller/src/main.ts"), "--stop-on-stdin-end"], {
  stdio: ["pipe", "pipe", "inherit"],
});
const lines = createInterface({ input: child.stdout });
const fail = (msg: string): never => {
  child.kill("SIGKILL");
  process.stderr.write(`smoke-mock-seller: FAIL ${msg}\n`);
  process.exit(1);
};
const timer = setTimeout(() => fail("timed out"), 15_000);

let statsLine = "";
const origin = await new Promise<string>((resolveOrigin) => {
  lines.on("line", (line) => {
    if (line.startsWith("mock-seller listening ")) resolveOrigin(line.slice("mock-seller listening ".length));
    if (line.startsWith("mock-seller stats ")) statsLine = line;
  });
});
if (!origin.startsWith("http://127.0.0.1:")) fail(`not on loopback: ${origin}`);

const res = await fetch(`${origin}/v1/forecast`);
const header = res.headers.get("payment-required");
if (res.status !== 402 || header === null) fail(`expected 402 with PAYMENT-REQUIRED, got ${String(res.status)}`);
const decoded = JSON.parse(Buffer.from(header ?? "", "base64").toString("utf8")) as { x402Version?: unknown };
if (decoded.x402Version !== 2) fail("decoded header is not x402Version 2");

const exited = once(child, "exit");
const closed = once(lines, "close");
child.stdin.end();
const [code] = (await exited) as [number | null];
await closed;
clearTimeout(timer);
if (code !== 0) fail(`mock seller exited ${String(code)} (${statsLine})`);
const stats = JSON.parse(statsLine.slice("mock-seller stats ".length) || "null") as {
  paymentHeadersSeen?: unknown;
} | null;
if (stats?.paymentHeadersSeen !== 0) fail(`mock seller did not report 0 payment headers (${statsLine})`);
process.stdout.write(`smoke-mock-seller: OK (402 + valid PAYMENT-REQUIRED on ${origin}; ${statsLine})\n`);
