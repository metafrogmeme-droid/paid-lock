<!-- Written with AI help. -->

# Spec sources

Every protocol field name in code must trace to a row here (CLAUDE.md §2). If the live docs differ from
CLAUDE.md, the docs win and a DECISIONS entry records it.

## x402 (read 31 Oct 2026)

Repository `x402-foundation/x402`, branch `main`, commit **`e208bd39030be35a0f807eb3bf4f043354273866`**.

| File                                            | Used for                                                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `specs/x402-specification-v2.md` §5.1           | `PaymentRequired`: `x402Version` (must be 2), `error`, `resource`, `accepts`, `extensions`. `ResourceInfo`: `url`, `description`, `mimeType`, `serviceName`, `tags`, `iconUrl`.                                          |
| `specs/x402-specification-v2.md` §5.1.2         | `PaymentRequirements`: `scheme`, `network` (CAIP-2), `amount` (atomic units string), `asset`, `payTo` (address or role constant), `maxTimeoutSeconds`, `extra` (reserved keys below). Extensions are `{ info, schema }`. |
| `specs/x402-specification-v2.md` §6.1           | `extra.assetTransferMethod`, `extra.paymentFlow` (`authorization` default, `upfront`, `escrow`); clients MUST NOT pay a flow they do not recognise; non-`authorization` flows MUST be explicit.                          |
| `specs/x402-specification-v2.md` Document Scope | "Client-side budget management" is out of scope of the spec.                                                                                                                                                             |
| `specs/transports-v2/http.md`                   | 402 + `PAYMENT-REQUIRED` response header, Base64-encoded JSON. Request header `PAYMENT-SIGNATURE` and response header `PAYMENT-RESPONSE` (paid.lock never sends the former).                                             |
| `specs/x402-specification-v1.md` §5.1           | v1 `PaymentRequirementsResponse` (`x402Version`, `error`, `accepts`), requirements with `maxAmountRequired`, network names such as `base-sepolia`, `resource`, `description`, `mimeType`, `outputSchema`.                |
| `specs/transports-v1/http.md`                   | v1: 402 with the requirements in the JSON **body**; client header `X-PAYMENT`; server header `X-PAYMENT-RESPONSE`.                                                                                                       |
| `specs/schemes/upto/scheme_upto.md`             | For `upto`, `amount` at verification time is the **maximum** the client authorises.                                                                                                                                      |
| `specs/extensions/sign-in-with-x.md`            | This extension puts a per-request `nonce`, `issuedAt`, `expirationTime` into `PaymentRequired.extensions`. Consequence for hashing: see PROPOSALS P-01.                                                                  |

| `specs/x402-specification-v2.md` §5.1.2, `specs/extensions/sign-in-with-x.md` "Server-Declared Fields" | Per-request `info` fields left out of the envelope hash: `nonce`, `issuedAt`, `expirationTime`, `notBefore`, `requestId`. |
| `specs/extensions/extension-offer-and-receipt.md` §4 | `extensions["offer-receipt"].info.offers[]` restates `accepts[]` terms with `validUntil` and signatures: left out of the envelope hash. |
| `typescript/packages/mechanisms/evm/src/constants.ts` `EVM_NETWORK_CHAIN_ID_MAP` | v1 EVM network names → chain ids, used for the v1 → CAIP-2 table (`packages/protocols/src/networks.ts`). |
| `typescript/packages/mechanisms/svm/src/constants.ts` `V1_TO_V2_NETWORK_MAP` | v1 Solana network names → CAIP-2. |
| `specs/transports-v2/http.md` example header | Used verbatim as a conformance fixture in `packages/protocols/src/x402.test.ts`. |

Parser input limits (CLAUDE.md §3 item 3): header ≤ 128 KiB, body ≤ 1 MiB, JSON depth ≤ 64, at most 64 `accepts`
entries, strict canonical Base64, duplicate JSON object keys refused (parsers disagree on which value wins).

Fixture asset: Base Sepolia USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` on `eip155:84532`, copied from the
x402 v2 spec example (testnet).

## MPP (not yet verified)

`https://mpp.dev/protocol/challenges` and `https://paymentauth.org/draft-httpauth-payment-01.pdf` could not be
fetched from the build environment on 31 Oct 2026 (egress policy denied both hosts). Nothing MPP-specific is
coded yet. Before M5 these must be read and pinned here (URL + date + draft revision). See OPEN_QUESTIONS Q-B.

## Comparison sources

`https://settlens.com/docs/checks` was also not reachable from the build environment. No text from it is used.
