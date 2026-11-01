// Written with AI help.
import { describe, expect, it } from "vitest";
import { isJsonObject } from "./json.ts";

describe("isJsonObject", () => {
  it("is true for plain objects only", () => {
    expect(isJsonObject({ a: 1 })).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject("x")).toBe(false);
  });
});
