// Writes schemas/paid.lock.v1.schema.json from the zod schema in packages/core/src/lock.ts.
// Usage: node scripts/gen-lock-schema.ts   (tests/lock-schema.test.ts fails if the file is stale)
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { lockJsonSchema } from "../packages/core/src/lock.ts";

export const SCHEMA_PATH = resolve(import.meta.dirname, "../schemas/paid.lock.v1.schema.json");

export function renderSchema(): string {
  return `${JSON.stringify(lockJsonSchema(), null, 2)}\n`;
}

if (process.argv[1] === import.meta.filename) {
  writeFileSync(SCHEMA_PATH, renderSchema());
  process.stdout.write(`gen-lock-schema: wrote ${SCHEMA_PATH}\n`);
}
