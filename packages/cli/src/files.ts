// Written with AI help.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { parseLock, serializeLock, type Lock } from "@paid-lock/core";

export class CliError extends Error {
  override readonly name = "CliError";
}

export function readLock(path: string): Lock {
  if (!existsSync(path)) throw new CliError(`${path} not found (run paid-lock init)`);
  const r = parseLock(readFileSync(path, "utf8"));
  if (!r.ok) throw new CliError(`paid.lock is invalid:\n  ${r.errors.slice(0, 10).join("\n  ")}`);
  return r.lock;
}

/** Write atomically (temp file + rename) so an interrupted run never leaves a half-written lock. */
export function writeLock(path: string, lock: Lock): void {
  const tmp = `${path}.tmp-${String(process.pid)}`;
  writeFileSync(tmp, serializeLock(lock));
  renameSync(tmp, path);
}

export function lockExists(path: string): boolean {
  return existsSync(path);
}
