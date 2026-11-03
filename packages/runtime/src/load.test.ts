import {
  emptyLock,
  endpointKey,
  lockDigest,
  MAX_LOCK_BYTES,
  newEndpoint,
  serializeLock,
  type Lock,
} from "@paid-lock/core";
import { parsePaymentRequired } from "@paid-lock/protocols";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLock, LockLoadError, type LoadLockOptions } from "./load.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paid-lock-runtime-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadLock", () => {
  it("reads and validates a lock file", async () => {
    const file = join(dir, "paid.lock");
    writeFileSync(file, serializeLock(emptyLock()));
    await expect(loadLock(file)).resolves.toEqual(emptyLock());
  });

  it("fails with LockLoadError when the file is missing", async () => {
    await expect(loadLock(join(dir, "nope.lock"))).rejects.toThrow(LockLoadError);
  });

  it("fails with LockLoadError and the schema errors when the lock is invalid", async () => {
    const file = join(dir, "paid.lock");
    writeFileSync(file, JSON.stringify({ lockfileVersion: 2, endpoints: {} }));
    const err = await loadLock(file).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LockLoadError);
    expect((err as LockLoadError).errors.length).toBeGreaterThan(0);
  });

  it("refuses a file larger than the lock size limit without parsing it", async () => {
    const file = join(dir, "paid.lock");
    writeFileSync(file, " ".repeat(MAX_LOCK_BYTES + 1));
    await expect(loadLock(file)).rejects.toThrow("too large");
  });

  it("refuses a directory", async () => {
    await expect(loadLock(dir)).rejects.toThrow(LockLoadError);
  });

  it("returns a frozen lock, so a hook cannot change it by accident", async () => {
    const file = join(dir, "paid.lock");
    writeFileSync(file, serializeLock(emptyLock()));
    const lock = await loadLock(file);
    expect(Object.isFrozen(lock)).toBe(true);
    expect(Object.isFrozen(lock.endpoints)).toBe(true);
  });
});

describe("loadLock with expectedDigest (P-04)", () => {
  // Test fixture: fake payTo; the asset is Base Sepolia (testnet) USDC from the x402 v2 spec.
  function sampleLock(payTo = "0x0000000000000000000000000000000000001001"): Lock {
    const parsed = parsePaymentRequired({
      x402Version: 2,
      resource: { url: "https://shop.example.com/v1/forecast" },
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
    });
    if (!parsed.ok) throw new Error(parsed.reason);
    const lock = emptyLock();
    lock.endpoints[endpointKey("GET", "https://shop.example.com/v1/forecast")] = newEndpoint(parsed.terms, {
      toleranceBps: 0,
    });
    return lock;
  }
  const write = (lock: Lock): string => {
    const file = join(dir, "paid.lock");
    writeFileSync(file, serializeLock(lock));
    return file;
  };

  it("loads a lock whose digest matches", async () => {
    const lock = sampleLock();
    await expect(loadLock(write(lock), { expectedDigest: lockDigest(lock) })).resolves.toEqual(lock);
  });

  it("refuses a lock that was changed after the digest was taken", async () => {
    const reviewed = lockDigest(sampleLock());
    const file = write(sampleLock("0x000000000000000000000000000000000000dEaD"));
    const err = await loadLock(file, { expectedDigest: reviewed }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LockLoadError);
    expect((err as Error).message).toContain("does not match the expected digest");
  });

  it("refuses an expected digest that is not a sha256-<base64> string, including an empty one", async () => {
    const file = write(sampleLock());
    for (const expectedDigest of ["", "sha256-", "sha512-abc", lockDigest(sampleLock()).slice(0, -2)]) {
      await expect(loadLock(file, { expectedDigest })).rejects.toThrow("expectedDigest");
    }
  });

  it("checks the digest of the content, so reformatting the file does not matter", async () => {
    const lock = sampleLock();
    const file = join(dir, "paid.lock");
    writeFileSync(file, JSON.stringify(JSON.parse(serializeLock(lock))));
    await expect(loadLock(file, { expectedDigest: lockDigest(lock) })).resolves.toEqual(lock);
  });

  it("refuses an expectedDigest key that is present but undefined, e.g. an unset environment variable (review M2)", async () => {
    const file = write(sampleLock());
    const options = { expectedDigest: undefined } as unknown as LoadLockOptions;
    await expect(loadLock(file, options)).rejects.toThrow("expectedDigest");
  });

  it("without expectedDigest, loads any valid lock as before", async () => {
    const lock = sampleLock();
    await expect(loadLock(write(lock), {})).resolves.toEqual(lock);
  });
});
