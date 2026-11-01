// Written with AI help.
import { describe, expect, it } from "vitest";
import { X402_V2_PAYMENT_REQUIRED_HEADER } from "./headers.ts";

describe("x402 v2 header names", () => {
  it("reads only the PAYMENT-REQUIRED response header (x402 transports-v2/http.md)", () => {
    expect(X402_V2_PAYMENT_REQUIRED_HEADER).toBe("PAYMENT-REQUIRED");
  });
});
