<!-- Written with AI help. -->

# paid.lock format, version 1

Approved in PROPOSALS P-01 (1 Nov 2026). Machine-readable schema: [`schemas/paid.lock.v1.schema.json`](../schemas/paid.lock.v1.schema.json)
(JSON Schema 2020-12, generated from `packages/core/src/lock.ts`; cross-field rules below are checked by `parseLock`).

## Example

```json
{
  "endpoints": {
    "GET https://api.example.com/v1/forecast": {
      "observed": {
        "envelopeIntegrity": "sha256-RBNvo1WzZ4oRRq0W9+hknpT7T8If536DEMBg9hyq/4o=",
        "options": {
          "exact eip155:84532 0x036CbD53842c5426634e7929541eC2318f3dCF7e 0x0000000000000000000000000000000000001001": {
            "amount": "10000",
            "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            "assetTransferMethod": null,
            "extra": { "name": "USDC", "version": "2" },
            "integrity": "sha256-…",
            "maxTimeoutSeconds": 60,
            "network": "eip155:84532",
            "otherFields": {},
            "payTo": "0x0000000000000000000000000000000000001001",
            "paymentFlow": "authorization",
            "scheme": "exact"
          }
        },
        "protocol": "x402",
        "resourceUrl": "https://api.example.com/v1/forecast",
        "x402Version": 2
      },
      "policy": {
        "options": {
          "exact eip155:84532 0x036CbD53842c5426634e7929541eC2318f3dCF7e 0x0000000000000000000000000000000000001001": {
            "maxAmount": "10000"
          }
        }
      }
    }
  },
  "lockfileVersion": 1
}
```

(The real file prints every object across lines; `extra` is shortened here.)

## Layout rules

- **Deterministic.** Same input, same bytes: keys sorted by UTF-16 code units (as RFC 8785), two-space indent, one
  trailing newline. No timestamps, no tool version (git records when and by whom). Re-locking unchanged terms is a
  no-op diff. `parseLock` → `serializeLock` is byte-identical.
- **Endpoint key:** `"<METHOD> <URL>"`, method `GET` or `POST`, URL normalised by the WHATWG URL parser
  (`new URL(url).href`).
- **`observed`** is what the unpaid probe saw. Only `paid-lock update` rewrites it.
- **`policy`** is the owner's. The tool never changes or removes a policy entry; `update` only adds a default
  entry (`maxAmount` = observed amount) for an option that has none, so the lock stays valid.
- **Options are keyed by identity:** `"<scheme> <network> <asset> <payTo>"` (single spaces; each part is printable
  ASCII without spaces, otherwise the 402 is unreadable). Order in `accepts[]` does not matter; a new or removed
  identity is a change.

## Fields

| Path                            | Meaning                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `lockfileVersion`               | `1`.                                                                                                                               |
| `observed.protocol`             | `"x402"` (MPP arrives in M5).                                                                                                      |
| `observed.x402Version`          | Pinned. A different version is `PROTOCOL_VERSION_CHANGED` (Needs your OK).                                                         |
| `observed.resourceUrl`          | `resource.url` (v2) or the accepts' `resource` (v1), normalised.                                                                   |
| `observed.envelopeIntegrity`    | Hash of the parts outside `accepts[]` that can change terms (see below).                                                           |
| `observed.options.<id>.*`       | The normalised option (fields below) plus `integrity`, its terms hash.                                                             |
| `policy.options.<id>.maxAmount` | Highest acceptable `amount` in atomic units. Defaults to the observed amount (zero tolerance).                                     |
| `policy.tighten`                | Optional list of "Needs your OK" codes the owner turns into "Blocked". Blocked codes cannot be listed, so nothing loosens a block. |

### Normalised option

| Field                 | From (x402 v2 `PaymentRequirements`)                       | Normalisation                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scheme`              | `scheme`                                                   | exact                                                                                                                                                                                    |
| `network`             | `network` (v1 names mapped to CAIP-2 by an explicit table) | must match CAIP-2                                                                                                                                                                        |
| `asset`, `payTo`      | `asset`, `payTo`                                           | on `eip155:*`, 20-byte hex addresses are stored EIP-55; a mixed-case address with a bad checksum is refused. Anything else (non-EVM addresses, ISO 4217 codes, role constants) is exact. |
| `amount`              | `amount` (v1: `maxAmountRequired`)                         | atomic-unit integer string, at most 78 digits; for `upto` it is the maximum                                                                                                              |
| `maxTimeoutSeconds`   | `maxTimeoutSeconds`                                        | non-negative integer                                                                                                                                                                     |
| `paymentFlow`         | `extra.paymentFlow`                                        | absent → `authorization` (v2 §6.1); must be `authorization`, `upfront` or `escrow`, otherwise unreadable                                                                                 |
| `assetTransferMethod` | `extra.assetTransferMethod`                                | absent → `null`                                                                                                                                                                          |
| `extra`               | `extra` without the two reserved keys                      | as received                                                                                                                                                                              |
| `otherFields`         | keys of the accepts entry that x402 does not define        | as received (so drift in them is still visible)                                                                                                                                          |

## Terms hash per option (`integrity`)

`"sha256-" + base64(SHA-256(UTF-8(JCS(payload))))`, where JCS is RFC 8785 and `payload` is exactly:

```
{ scheme, network, asset, payTo, maxTimeoutSeconds, paymentFlow, assetTransferMethod, extra, otherFields }
```

i.e. every option field **except `amount`**: the price is compared with `policy.maxAmount` instead, so a price drop
never changes the hash and never fails. `parseLock` recomputes every option hash and refuses a lock whose stored
hash does not match its fields.

## Envelope hash (`envelopeIntegrity`)

Same construction over an object built by the protocol parser from everything outside `accepts[]` that can change
what a client agrees to: `extensions` and any top-level field x402 does not define. Left out on purpose:

| Left out                                                                                          | Why                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error`                                                                                           | human-readable message                                                                                                                                    |
| `resource.description`, `mimeType`, `serviceName`, `tags`, `iconUrl`                              | descriptive metadata (`resource.url` is pinned separately)                                                                                                |
| `extensions["sign-in-with-x"].info.nonce`, `issuedAt`, `expirationTime`, `notBefore`, `requestId` | fresh per request (x402 `specs/extensions/sign-in-with-x.md`)                                                                                             |
| `extensions["offer-receipt"]` (whole)                                                             | signed restatement of `accepts[]` with per-offer expiry and signatures; the terms it signs are pinned directly. Pinning its signer is a stretch proposal. |

Any other extension change is reported as `TERMS_CHANGED_OTHER` (Needs your OK).
