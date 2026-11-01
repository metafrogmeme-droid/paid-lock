<!-- Written with AI help. -->

# Threat model (v1, M2)

Structure follows the threat-model layout of the `-claw-guard-near-` reference project (assets, actors, threats with
mitigations and the test that proves each). Grows with every milestone.

## What paid.lock protects

An agent's money, by making every change in where it goes (`payTo`, network, asset, scheme), how much it may cost
(`amount` vs `policy.maxAmount`) and how it is collected (`paymentFlow`) a reviewed decision instead of a silent one.
paid.lock itself holds **no keys and moves no money** (CLAUDE.md §5 rule 3).

## Actors

| Actor                                      | Can                                                               |
| ------------------------------------------ | ----------------------------------------------------------------- |
| Seller (honest, changing terms)            | change any field of its 402 at any time                           |
| Attacker in control of a seller or its CDN | serve any bytes as the 402, including oversized or malformed ones |
| Contributor with a PR to the agent's repo  | edit `paid.lock` by hand                                          |
| Supply chain                               | ship a malicious dependency or GitHub Action                      |

## Threats and mitigations

| #   | Threat                                                                                     | Mitigation                                                                                                                                     | Proven by                                                                  |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| T1  | Seller swaps `payTo` (or network, asset, scheme)                                           | identity match; any identity change is Blocked                                                                                                 | `verify.test.ts` blocked cases + property "any payTo change always blocks" |
| T2  | Seller replaces the locked option with a new one instead of editing it                     | vanished-and-appeared options are paired and every differing identity field is Blocked, not "new option"                                       | `verify.test.ts` "network swap … reports both changes"                     |
| T3  | Price rise                                                                                 | `amount > policy.maxAmount` is Blocked; bigint comparison                                                                                      | property "a price rise above the lock always blocks"                       |
| T4  | Address look-alike via case (EIP-55)                                                       | EVM addresses compared case-insensitively; a mixed-case address with a bad checksum is unreadable → Blocked                                    | `address.test.ts`, `terms.test.ts`                                         |
| T5  | Unknown payment flow (funds committed before the resource runs)                            | flows outside `authorization`, `upfront`, `escrow` are unreadable → Blocked; any flow change is Blocked                                        | `terms.test.ts`, `verify.test.ts`                                          |
| T6  | Ambiguous terms (two options with one identity, no options, non-CAIP-2 network)            | normalisation refuses → `REQUIREMENTS_UNREADABLE` (Blocked)                                                                                    | `terms.test.ts`, `verify.test.ts`                                          |
| T7  | Hand-edited lock hides a payTo change from reviewers                                       | `parseLock` recomputes every option hash from its fields and refuses a mismatch; strict schema (no unknown keys); addresses must be normalised | `lock.test.ts` "rejects a tampered payTo"                                  |
| T8  | Hand-edited lock loosens a block                                                           | `policy.tighten` accepts only "Needs your OK" codes; there is no loosen setting                                                                | `lock.test.ts`, `reasons.test.ts`                                          |
| T9  | Seller text spoofs CI output ("Allowed: …" on a new line)                                  | every verdict line is single-line; seller values clipped to 120 characters                                                                     | `verdict.test.ts`, `verify.test.ts`                                        |
| T10 | Resource exhaustion by a hostile lock file                                                 | 8 MiB size limit, depth limit 64 checked without unbounded recursion                                                                           | `lock.test.ts`                                                             |
| T11 | Per-request fields make every verify "changed", so people learn to ignore it               | per-request extension fields left out of the envelope hash (LOCK_FORMAT.md); amount left out of option hashes                                  | `terms.test.ts`, parser tests (M2-4)                                       |
| T12 | The tool pays or signs                                                                     | no wallet/signing dependency (allowlist), source scan, mock seller counter (M1)                                                                | `tests/deps.test.ts`, `tests/never-pays.test.ts`, mock seller tests        |
| T13 | Secrets committed                                                                          | gitleaks in CI (full history) and pre-commit, with self-test                                                                                   | `scripts/gitleaks-selftest.sh`                                             |
| T14 | Malicious dependency or action                                                             | allowlisted runtime deps (`@noble/hashes`, `zod`), 7-day minimum release age, actions pinned by SHA, tools by checksum, zizmor                 | CI                                                                         |
| T15 | Seller shows different terms to different requests (e.g. the CI probe vs the paying agent) | two identical probe requests; any difference needs your OK and every sample is verified                                                        | `verify.test.ts` "verifySamples"                                           |
| T16 | URL parser differences hide a resource or endpoint change                                  | strict normalisation (owner decision #10): path and query compared byte for byte; backslashes, whitespace and ambiguous authorities refused    | `url.test.ts`                                                              |

## Known gaps (tracked)

- **Unmodelled extension changes** show only "extensions changed" because the lock stores the envelope hash, not its
  content.
- **No lock signing yet.** A runtime still trusts whatever `paid.lock` is on disk (P-04, stretch: signed locks).
- **The probe is not built yet (M3).** Redirects, TLS, timeouts, sizes and two-sample instability arrive with it.
- **Nothing MPP-specific is modelled yet (M5).**
