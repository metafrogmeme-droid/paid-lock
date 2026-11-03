# Audit (M6)

Two passes before release (CLAUDE.md §6, M6): a self-review against the hard rules and the threat model, and an
independent second review that read the code without access to the self-review or to the authors' conclusions.
Static analysis runs in CI on every pull request. Every finding below is fixed or answered. Audit date: 3 Nov 2026,
code at `main` after #21 (`4a7d21f`).

## Method

| Pass              | What                                                                                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-review       | Hard rules §5 one by one, THREAT_MODEL T1–T30, dependency and supply-chain review, CI workflow review, a packaging dry run (`pnpm pack` of the five published packages).                                                                                                                |
| Second opinion    | A separate reviewer (an independent agent run, read-only) given the code, the hard rules and a list of areas, not the self-review. Each finding had to name a file, a line and a concrete failure path; claims it could not trace were dropped. 8 of 11 were confirmed by running code. |
| Static analysis   | Semgrep 1.183.0 (project rules + registry `p/javascript` and `p/typescript` packs) on every pull request: 0 findings. ESLint `strictTypeChecked`, TypeScript strict. CodeQL is not run: it needs a public repository or GitHub Advanced Security (see S3).                              |
| Workflow analysis | actionlint 1.7.12 and zizmor 1.31.1 on every workflow file, including `release.yml` and the example workflows: 0 findings (10 documented `self-repository` ignores in the Action self-test).                                                                                            |
| Dependencies      | `pnpm audit`: one reviewed dev-only exception (GHSA-g3hv-75wg-m249, minimatch via eslint, D-012, re-check by 15 Nov 2026). Production dependencies of published packages: `zod`, `@noble/hashes` only (allowlist test). 7-day minimum release age.                                      |

## Second opinion: findings and outcomes

No path was found where a changed payTo, network, asset, scheme or a price above the lock comes out Allowed in the
core, the parsers or the runtime adapter. The findings:

| #   | Severity | Finding                                                                                                                                       | Outcome                                                                                                     |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| M1  | medium   | An x402 v2 header plus a v1 body with different terms was read as the header alone (CI Allowed while a v1 client could pay the body's payTo). | Fixed in #23: unreadable unless the body repeats the header's terms exactly; the probe reads the body too.  |
| M2  | medium   | `loadLock(path, { expectedDigest: process.env.X })` with `X` unset loaded any lock (pin silently off).                                        | Fixed in #24: a given but undefined digest throws.                                                          |
| M3  | medium   | A seller could make `add` / `update` write a lock that never parses again (empty `assetTransferMethod`), so every check became a tool error.  | Fixed in #23: refused at normalisation; property test that every accepted observation round-trips the lock. |
| L1  | low      | Some IPv6 special-purpose ranges were classified as allowed (IPv4-compatible, IPv4-translated, Teredo, site-local).                           | Fixed in #25 (plus 2001::/23, 3fff::/20, 5f00::/16).                                                        |
| L2  | low      | Seller text could @-mention people in the summary / PR comment, and the legacy `##[` command syntax reached log lines.                        | Fixed in #25: zero-width space after `@`; `##[` broken in logs and annotations.                             |
| L3  | low      | The sticky PR comment updated any comment that starts with the marker, whoever wrote it.                                                      | Fixed in #25: bot-authored comments only.                                                                   |
| L4  | low      | `parseLock` accepted duplicate JSON keys (last one wins).                                                                                     | Fixed in #23: refused, with the same guard the 402 parsers use.                                             |
| L5  | low      | `verify <url>` / `update <url>` always looked up the GET entry.                                                                               | Fixed in #24: `--method` honoured.                                                                          |
| L6  | low      | `add` pinned terms whose resource URL differs from the requested URL (the T23 entry path).                                                    | Fixed in #24: `RESOURCE_URL_MISMATCH` (Blocked) at add, nothing written.                                    |
| L7  | low      | MPP terms took the re-serialised `URL#href` in CI but the raw URL at pay time (false Block on non-ASCII paths or `https://h`).                | Fixed in #23: the normalised requested URL in both places.                                                  |
| L8  | low      | The lock's temp file had a guessable name; the Action resolves workspace paths without `realpath`.                                            | Temp file fixed in #24 (random name, exclusive create). Action paths: answered, see A1.                     |
| N1  | note     | Unreadable reasons repeated up to 40 characters of seller text (against a strict reading of §5 rule 13).                                      | Fixed in #23.                                                                                               |
| N2  | note     | `checkAgainstLock` alone with `failOn: "blocked"` lets a payment through to a new option (`NEW_OPTION_OFFERED` is Needs your OK).             | Answered, see A2.                                                                                           |
| N3  | note     | Python CI tools (semgrep, zizmor) are pinned by version, not by hash.                                                                         | Answered, see S2.                                                                                           |

### Answers

- **A1 (L8, Action paths).** The Action reads the lock and writes SARIF inside `GITHUB_WORKSPACE`, refusing paths that
  leave it; it does not resolve symlinks. A symlink there comes from the repository's own content, and a
  `pull_request` job already runs that pull request's workflow code with the same permissions, so following it gives
  no new capability. Not changed.
- **A2 (N2).** The default is `failOn: "needs-ok"`, under which a new option is not paid. The bundled x402 adapter also
  checks the selected option (`checkSelected`). Integrators who call `checkAgainstLock` directly and loosen to
  `"blocked"` should check the selected option too; the SPEC's runtime section and the runtime README say so.

## Self-review

| #   | Area                    | Result                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Hard rules §5           | Never pays: no wallet or signing dependency (allowlist), no payment header or signing call in shipped code (scan), the mock seller counts payment headers in every end-to-end test, the demo and the Action self-test (always 0). No secrets: gitleaks on full history and pre-commit, with self-test. Wording: copy-lint. MIT everywhere. Flags default off. No AI-authorship labels (rule 7 as of 3 Nov). |
| S2  | CI supply chain         | Actions pinned by full SHA, tool binaries by SHA-256, `contents: read`, `persist-credentials: false`, inputs passed through `env:`. The Python tools are version-pinned, not hash-pinned: accepted for CI-only tools that never see a secret; a hash-pinned requirements file is a small follow-up if wanted.                                                                                               |
| S3  | CodeQL                  | Not available on a private repository without GitHub Advanced Security. After the repository is made public (RELEASE.md), enable CodeQL default setup for JavaScript/TypeScript and record its first result here before the Marketplace release.                                                                                                                                                            |
| S4  | Packaging (`pnpm pack`) | Five tarballs, `workspace:*` rewritten, `dist` only. Two gaps, fixed in the packaging PR: each package now ships `LICENSE` and `README.md`, and `publishConfig.exports` leaves out the repo-only `@paid-lock/source` condition (which points at unshipped `src/`); source maps are not shipped. A test keeps this in place.                                                                                 |
| S5  | Threat model            | T1–T30 each have a mitigation and a test or CI check; updated with the fixes above (T9, T17, T23, T26, T28). Remaining known gaps: MPP chain ids pinned as "other terms" until `draft-evm-charge-00` is read; no signed locks (digest pin only).                                                                                                                                                            |
| S6  | Tests and coverage      | Tests first throughout; core coverage ≥ 95% lines and branches (gate in CI); property tests on the canonicaliser, hashes, verify, parsers and the lock round-trip; the contract test keeps CLI and runtime verdicts identical.                                                                                                                                                                              |
