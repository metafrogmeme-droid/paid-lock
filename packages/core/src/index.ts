// Written with AI help.
export { normalizeAddress, toChecksumAddress, type Normalized } from "./address.ts";
export { applyTolerance, isAmount, MAX_TOLERANCE_BPS } from "./amount.ts";
export { integrityOf, isIntegrity, sha256Base64, type Integrity } from "./integrity.ts";
export { canonicalize, CanonicalizationError, MAX_DEPTH } from "./jcs.ts";
export { isJsonObject, type Json, type JsonObject } from "./json.ts";
export { VERDICTS, verdictLine, type Verdict } from "./verdict.ts";
