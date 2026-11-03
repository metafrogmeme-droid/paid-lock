// Read paid.lock for pay-time checks. The only I/O in this package. The lock is validated with the
// same schema as the CLI uses and frozen, so the checks run against exactly what was reviewed.
import { isIntegrity, lockDigest, MAX_LOCK_BYTES, parseLock, type Lock } from "@paid-lock/core";
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

export interface LoadLockOptions {
  /**
   * Digest of the reviewed lock (`paid-lock digest`, P-04). When set, a lock with any other digest is
   * refused. Set it at build or deploy time, outside the reach of whoever can write paid.lock on the host.
   */
  expectedDigest?: string;
}

/** Load and validate a lock file (default `paid.lock` in the working directory). Throws LockLoadError. */
export async function loadLock(path = "paid.lock", options: LoadLockOptions = {}): Promise<Readonly<Lock>> {
  const { expectedDigest } = options;
  // A key that is present but undefined (e.g. `process.env.PAID_LOCK_DIGEST` when the variable is unset) is
  // a pin that failed to arrive, not "no pin" (audit M2).
  if (Object.hasOwn(options, "expectedDigest") && expectedDigest === undefined) {
    throw new LockLoadError("expectedDigest is set but undefined (an unset environment variable?)");
  }
  // An empty or malformed value (e.g. an unset environment variable) must not silently turn the pin off.
  if (expectedDigest !== undefined && !isIntegrity(expectedDigest)) {
    throw new LockLoadError("expectedDigest is not a sha256-<base64> digest (see paid-lock digest)");
  }
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
  if (expectedDigest !== undefined) {
    const actual = lockDigest(r.lock);
    if (actual !== expectedDigest) {
      throw new LockLoadError(
        `${path} does not match the expected digest (expected ${expectedDigest}, found ${actual})`,
      );
    }
  }
  return deepFreeze(r.lock);
}
