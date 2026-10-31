<!-- Written with AI help. -->

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
| A   | Empty repo: no `main` to open a PR against | Owner creates `main` with one commit (e.g. GitHub web: add LICENSE), or allows one root commit to `main` containing only LICENSE. Rule 5 stops Claude from pushing to `main` itself.                         |
| B   | MPP sources                                | mpp.dev and paymentauth.org were blocked by the build environment's network policy. Either allow those hosts for M5 or paste the docs (URL + revision) into a DECISIONS entry.                               |
| C   | Reason-code enum                           | P-01 adds `PROTOCOL_VERSION_CHANGED`. Also: should `RESOURCE_URL_MISMATCH` compare origin + path only (query and trailing-slash differences become Needs your OK) instead of Blocked on any byte difference? |
