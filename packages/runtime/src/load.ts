// Written with AI help.
// Read paid.lock for pay-time checks. The only I/O in this package. The lock is validated with the
// same schema as the CLI uses and frozen, so the checks run against exactly what was reviewed.
import { MAX_LOCK_BYTES, parseLock, type Lock } from "@paid-lock/core";
import { readFile, stat } from "node:fs/promises";

export class LockLoadError extends Error {
  override readonly name = "LockLoadError";
  readonly errors: readonly string[];
  constructor(message: string, errors: readonly string[] = []) {
    super(message);
    this.errors = errors;
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** Load and validate a lock file (default `paid.lock` in the working directory). Throws LockLoadError. */
export async function loadLock(path = "paid.lock"): Promise<Readonly<Lock>> {
  let size: number;
  try {
    const s = await stat(path);
    if (!s.isFile()) throw new LockLoadError(`${path} is not a file`);
    size = s.size;
  } catch (e) {
    if (e instanceof LockLoadError) throw e;
    throw new LockLoadError(`${path} could not be read`);
  }
  if (size > MAX_LOCK_BYTES) throw new LockLoadError(`${path} is too large`);
  const r = parseLock(await readFile(path, "utf8"));
  if (!r.ok) throw new LockLoadError(`${path} is not a valid paid.lock`, r.errors);
  return deepFreeze(r.lock);
}
