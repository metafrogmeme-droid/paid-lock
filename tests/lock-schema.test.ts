import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderSchema, SCHEMA_PATH } from "../scripts/gen-lock-schema.ts";

describe("schemas/paid.lock.v1.schema.json", () => {
  it("is fresh (regenerate with: node scripts/gen-lock-schema.ts)", () => {
    expect(readFileSync(SCHEMA_PATH, "utf8")).toBe(renderSchema());
  });

  it("is draft 2020-12, strict, and pins lockfileVersion 1", () => {
    const schema = JSON.parse(renderSchema()) as {
      $schema: string;
      additionalProperties: boolean;
      properties: { lockfileVersion: { const: number } };
    };
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.lockfileVersion.const).toBe(1);
  });
});
