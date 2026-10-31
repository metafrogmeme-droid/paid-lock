// Written with AI help.
/**
 * The x402 v2 HTTP response header that carries the Base64-encoded `PaymentRequired` object.
 * Source: x402 specs/transports-v2/http.md, "Payment Required Signaling" (see docs/SPEC_SOURCES.md).
 * paid.lock only ever reads this response header; it has no request-side payment header names.
 */
export const X402_V2_PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
