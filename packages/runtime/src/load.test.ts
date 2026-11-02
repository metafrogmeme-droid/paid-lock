// Written with AI help.
import { emptyLock, MAX_LOCK_BYTES, serializeLock } from "@paid-lock/core";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLock, LockLoadError } from "./load.ts";

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
