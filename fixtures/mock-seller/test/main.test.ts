// Test fixture. The mock seller CLI (src/main.ts) as a child process: the cross-platform stop by closing stdin
// (what scripts/smoke-mock-seller.ts uses, because a child's SIGTERM on Windows runs no handler), and the
// exit code that fails a run when a payment header was seen.
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

interface Running {
  child: ChildProcessByStdio<Writable, Readable, null>;
  origin: string;
  lines: string[];
}

async function startCli(args: string[]): Promise<Running> {
  const child = spawn(process.execPath, [MAIN, ...args], { stdio: ["pipe", "pipe", "inherit"] });
  const lines: string[] = [];
  const rl = createInterface({ input: child.stdout });
  const origin = await new Promise<string>((resolveOrigin, reject) => {
    rl.on("line", (line) => {
      lines.push(line);
      if (line.startsWith("mock-seller listening ")) resolveOrigin(line.slice("mock-seller listening ".length));
    });
    child.once("exit", (code) => {
      reject(new Error(`mock seller exited early (${String(code)})`));
    });
  });
  return { child, origin, lines };
}

async function stopByStdin(r: Running): Promise<{ code: number | null; stats: Record<string, unknown> }> {
  const exited = once(r.child, "exit");
  const closed = once(r.child.stdout, "close");
  r.child.stdin.end();
  const [code] = (await exited) as [number | null];
  await closed;
  const statsLine = r.lines.find((l) => l.startsWith("mock-seller stats ")) ?? "";
  return { code, stats: JSON.parse(statsLine.slice("mock-seller stats ".length) || "{}") as Record<string, unknown> };
}

describe("mock seller CLI shutdown", { timeout: 60_000 }, () => {
  it("with --stop-on-stdin-end, closing stdin stops it: stats line printed, exit 0, no payment header", async () => {
    const r = await startCli(["--stop-on-stdin-end"]);
    expect((await fetch(`${r.origin}/v1/forecast`)).status).toBe(402);
    expect(await stopByStdin(r)).toMatchObject({ code: 0, stats: { requests: 1, paymentHeadersSeen: 0 } });
  });

  it("still exits 1 when a request carried a payment header", async () => {
    const r = await startCli(["--stop-on-stdin-end"]);
    await fetch(`${r.origin}/v1/forecast`, { headers: { "PAYMENT-SIGNATURE": "test-not-a-payment" } });
    expect(await stopByStdin(r)).toMatchObject({ code: 1, stats: { paymentHeadersSeen: 1 } });
  });

  it("without the flag, stdin closing does not stop it (background use is unchanged)", async () => {
    const r = await startCli([]);
    r.child.stdin.end();
    await new Promise((done) => setTimeout(done, 500));
    expect(r.child.exitCode).toBeNull();
    expect((await fetch(`${r.origin}/v1/forecast`)).status).toBe(402);
    const exited = once(r.child, "exit");
    r.child.kill("SIGKILL");
    await exited;
  });

  it.skipIf(process.platform === "win32")("on POSIX, SIGTERM still stops it gracefully with exit 0", async () => {
    const r = await startCli([]);
    const exited = once(r.child, "exit");
    r.child.kill("SIGTERM");
    const [code] = (await exited) as [number | null];
    expect(code).toBe(0);
  });
});
