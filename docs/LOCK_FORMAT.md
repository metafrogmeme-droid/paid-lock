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
- **Endpoint key:** `"<METHOD> <URL>"`, method `GET` or `POST`, URL normalised as below.
- **URL normalisation** (owner decision #10), used for endpoint keys and `observed.resourceUrl`: lowercase the
  scheme and host, drop the default port (`:80` for http, `:443` for https), drop the fragment. The path and query
  are kept byte for byte: no trailing-slash, dot-segment, percent-encoding or query rewriting, so any path or query
  difference is a mismatch. URLs with whitespace, control characters, backslashes, credentials or an
  ambiguous authority are refused.
- **`observed`** is what the unpaid probe saw. Only `paid-lock update` rewrites it.
- **`policy`** is the owner's. The tool never changes or removes a policy entry; `update` only adds a default
  entry (`maxAmount` = observed amount) for an option that has none, so the lock stays valid.
- **Options are keyed by identity:** `"<scheme> <network> <asset> <payTo>"` (single spaces; each part is printable
  ASCII without spaces, otherwise the 402 is unreadable). Order in `accepts[]` does not matter; a new or removed
  identity is a change.

## Fields

| Path                            | Meaning                                                                                                                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lockfileVersion`               | `1`.                                                                                                                                                                                                                                    |
| `observed.protocol`             | `"x402"` or `"mpp"` (MPP `Payment` challenges, see below).                                                                                                                                                                              |
| `observed.x402Version`          | x402 only, pinned. A different version, or a switch between x402 and MPP, is `PROTOCOL_VERSION_CHANGED` (Needs your OK). MPP entries have no such key.                                                                                  |
| `observed.resourceUrl`          | `resource.url` (v2) or the accepts' `resource` (v1), normalised as above; any difference is `RESOURCE_URL_MISMATCH` (Blocked).                                                                                                          |
| `observed.envelopeIntegrity`    | Hash of the parts outside `accepts[]` that can change terms (see below).                                                                                                                                                                |
| `observed.options.<id>.*`       | The normalised option (fields below) plus `integrity`, its terms hash.                                                                                                                                                                  |
| `policy.options.<id>.maxAmount` | Highest acceptable `amount` in atomic units. Defaults to the observed amount (zero tolerance).                                                                                                                                          |
| `policy.allowPrivateNetwork`    | Optional, `true` only. Allows probing this endpoint on a private, link-local or loopback address (refused by default; owner decision of 2 Nov 2026). Written by `paid-lock add --allow-private-network`. Review it like a payTo change. |
| `policy.tighten`                | Optional list of "Needs your OK" codes the owner turns into "Blocked". Blocked codes cannot be listed, so nothing loosens a block.                                                                                                      |

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

### MPP challenges as options (DECISIONS D-027)

Each `WWW-Authenticate: Payment` challenge with intent `charge` becomes one option. Same fields, so the same
identity rules, hashes and verdicts apply.

| Field                 | From the challenge                                      | Notes                                                                                                               |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `scheme`              | `intent` (only `charge` is read; others are unreadable) |                                                                                                                     |
| `network`             | `"mpp:" + method`                                       | CAIP-2-shaped name, not a chain id; a different `method` is `NETWORK_CHANGED`                                       |
| `asset`               | request `currency`                                      | exact (ISO 4217 code or token address; not EIP-55, because `mpp:*` is not `eip155:*`)                               |
| `payTo`               | request `recipient`; if absent, `"realm:" + realm`      | without a recipient the money goes to whoever runs the realm, so a realm change is then `PAYTO_CHANGED`             |
| `amount`              | request `amount`                                        | base units, compared with `maxAmount` like x402                                                                     |
| `maxTimeoutSeconds`   | `0`                                                     | MPP has a per-challenge `expires` instead, which is not pinned                                                      |
| `paymentFlow`         | `authorization`                                         | MPP has no payment flow; the x402 default is stored so the field never changes                                      |
| `assetTransferMethod` | `null`                                                  |                                                                                                                     |
| `extra`               | `{ realm, methodDetails }`                              | a change is `TERMS_CHANGED_OTHER` (e.g. a chain id in `methodDetails`; tighten it to Blocked with `policy.tighten`) |
| `otherFields`         | request fields the charge intent does not define        | as received                                                                                                         |

`resourceUrl` is the URL that was requested (a challenge names none). Left out as per-challenge or display-only:
`id`, `expires`, `opaque`, `digest`, `description`, `header`, unknown auth-params, and the request's `description` and
`externalId`. The envelope is empty. A 402 that offers both x402 terms and MPP challenges is unreadable (Blocked),
and so is a `request` that is not unpadded base64url of JCS (RFC 8785) JSON.

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

## Verify outcomes per option

| Situation                                            | Code                                                                                           | Verdict                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------- |
| same identity, `amount <= maxAmount`                 | none; a drop below the observed amount is reported as a note                                   | Allowed                 |
| same identity, `amount > maxAmount`                  | `PRICE_ABOVE_LOCK`                                                                             | Blocked                 |
| same identity, other field changed                   | `PAYMENT_FLOW_CHANGED` / `TERMS_CHANGED_OTHER`                                                 | Blocked / Needs your OK |
| locked option gone and another appeared              | `PAYTO_CHANGED`, `NETWORK_CHANGED`, `ASSET_CHANGED`, `SCHEME_CHANGED` for each differing field | Blocked                 |
| extra option, nothing gone                           | `NEW_OPTION_OFFERED`                                                                           | Needs your OK           |
| locked option gone, nothing appeared                 | `OPTION_REMOVED` (owner decision #11)                                                          | Needs your OK           |
| the two identical probe requests saw different terms | `TERMS_CHANGED_OTHER`                                                                          | Needs your OK           |
