# Open questions for the owner

Recommendations are proposals until the owner answers (CLAUDE.md §7, §8).

| #   | Question                                   | Recommendation                                                                                                                                                                                               |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Package names                              | Unscoped `paid-lock` for the CLI (`npx paid-lock`), `@paid-lock/*` for core, protocols, probe, runtime. Create the free npm org `paid-lock` now to hold the scope; nothing gets published.                   |
| 2   | Default price tolerance                    | Zero (any rise is Blocked). `--tolerance` is opt-in per endpoint and written into the lock as an absolute `maxAmount`, so the file shows the real cap.                                                       |
| 3   | `TERMS_CHANGED_OTHER` in CI                | Default `fail-on: needs-ok` (fail closed; accepting is a reviewed `paid-lock update`). P-01 removes the per-request noise that would make this painful.                                                      |
| 4   | Settlens positioning                       | Yes: "open, generated, per-endpoint lock". A short facts-only table, each cell sourced and dated. settlens.com was not reachable from the build environment, so the owner checks the cells.                  |
| 5   | First real entry                           | Claw Pay check-api on Base Sepolia, in `examples/paid.lock`, created by the owner locally with `paid-lock add`. CI keeps using the mock seller (rule 4). Needs the URL.                                      |
| 6   | Hackathon / grant                          | Owner's call. Base Builder Grants fits open-source x402 tooling after 0.1.0; UBC eligibility is unconfirmed, so it should not drive scope.                                                                   |
| 7   | Visibility, CLAUDE.md                      | Public at 0.1.0 (Marketplace needs it; CodeQL becomes free). CLAUDE.md is marked confidential and names internal repos: move it to private notes before going public.                                        |
| 8   | Signed locks                               | After real users. P-04 (lock digest) is a cheap step towards it now.                                                                                                                                         |
| A   | Empty repo: no `main` to open a PR against | Resolved 1 Nov 2026: `main` starts with the brief commit `d4bcecd` ("docs: add build brief (CLAUDE.md)"); M1 is a draft PR from `m1-scaffold`.                                                               |
| B   | MPP sources                                | Answered 2 Nov 2026: the owner pasted the excerpts (SPEC_SOURCES, MPP section). Still to fetch: draft-evm-charge-00 for EVM `methodDetails`.                                                                 |
| C   | Reason-code enum                           | P-01 adds `PROTOCOL_VERSION_CHANGED`. Also: should `RESOURCE_URL_MISMATCH` compare origin + path only (query and trailing-slash differences become Needs your OK) instead of Blocked on any byte difference? |

| D | Claw Pay: paid.lock per seller, and its Needs your OK | Answered 3 Nov 2026: on for every seller by default, owner can turn it off per seller (logged in the receipt), stricter outcome wins; Needs your OK goes into Claw Pay's one owner OK queue with the reason code and the locked and new value (DECISIONS D-030, docs/CLAW_PAY.md). |

**Answered 1 Nov 2026:** the owner approved recommendations 1-11 (rows 1-8, B, C and `OPTION_REMOVED`), with the M3
defaults recorded in DECISIONS D-018.
