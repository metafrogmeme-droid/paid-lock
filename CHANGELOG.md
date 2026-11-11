# Changelog

All notable changes. Versions follow semantic versioning. The release PR renames a heading such as
`## 0.1.0 (unreleased)` to `## 0.1.0`; the release check only accepts the plain form (docs/RELEASE.md).

## 0.1.1

Same package code as 0.1.0. This is the first release published by the release workflow (`release.yml`): npm
trusted publishing (OIDC, no npm token) with npm provenance for each package. 0.1.0 was published once by hand and
has no provenance (docs/RELEASE.md, "First publish (one time)").

### Repository and release tooling (not part of the npm packages)

Already in the `v0.1.0` tag (`5a87659`) but missing from the 0.1.0 notes:

- One-time first publish: `scripts/first-publish.sh` (dry run by default; `--publish` with a typed confirmation;
  runs the release gates first and stops at the first error) and its runbook (#31, DECISIONS D-031).
- Windows (Git Bash) fixes found during the owner's first-publish dry run:
  - the first-publish script's tests have an explicit 60 s timeout, because starting bash is slow on Windows;
    RELEASE.md notes running from Git Bash with `core.autocrlf=false` (#32);
  - `check-deps` starts pnpm through `scripts/lib/pnpm.ts`, which works with the Windows `pnpm.cmd` shim (pnpm's
    own entry under `pnpm run`, no shell; otherwise `pnpm.cmd` with plain arguments only); the dependency check is
    unchanged (#33);
  - the smoke test stops the mock seller by closing its stdin (`--stop-on-stdin-end`) instead of SIGTERM, which on
    Windows ends a process without running its handler; it also checks that the seller saw 0 payment headers. The
    mock seller now prints "listening" only after its stop handlers are set (a race seen in CI), and the demo gives
    the CLI `SystemRoot` on Windows, which Windows networking needs (#34).

Since `v0.1.0`:

- docs/RELEASE.md records the 0.1.0 publish and what had to be done before 0.1.1 (#35).

## 0.1.0

First release: a lockfile for the paid endpoints an AI agent calls.

### Added

- **Lock format v1** (`paid.lock`): per endpoint, the observed terms and the owner's policy; options keyed by
  identity (scheme, network, asset, payTo); a `sha256-<base64>` terms hash per option over RFC 8785 canonical JSON;
  EIP-55 addresses; bigint amounts; a generated JSON Schema.
- **Three payment protocols, read only:** x402 v2 (`PAYMENT-REQUIRED` header), x402 v1 (JSON body) and MPP
  (`WWW-Authenticate: Payment` challenges, intent `charge`).
- **CLI** `paid-lock`: `init`, `add`, `verify`, `diff`, `update` (`--all`), `explain`, `digest`; `--json`;
  `--fail-on`; exit codes 0 allowed, 1 blocked, 2 needs your OK, 3 tool error.
- **Unpaid probe:** HTTPS only (loopback excepted), no redirects followed, private and special-purpose addresses
  refused unless the lock entry opts in, DNS pinned against rebinding, two samples, time and size limits.
- **GitHub Action:** job summary, SARIF 2.1.0, annotations, outputs, optional sticky PR comment (off by default);
  `contents: read`; no secret needed.
- **Runtime library** `@paid-lock/runtime`: `loadLock` (with an optional digest pin), `checkAgainstLock`,
  `checkSelected`, `checkResponse`, and hooks for the x402 TypeScript client (`installPaidLock`).
- **Verdicts:** only "Allowed: within your limits", "Blocked by your rule: …" and "Needs your OK: …", with stable
  reason codes; anything unreadable or ambiguous is Blocked; price drops never fail.
  A finding about one changed value also gives the locked and the new value as data (`change`), for an owner OK queue.

### Security

- Never pays, signs or loads a key: dependency allowlist, a source scan for payment headers and signing calls, and a
  mock seller that counts payment headers in every end-to-end test (always 0).
- The x402 client hooks are tested inside the official x402 TypeScript client (`@x402/core` 2.29.0, test only), with a
  scheme that never signs: changed terms, a copied 402 on another URL, a policy that rewrites `payTo` and wrong wiring
  all stop before payment creation.
- Audit before release (docs/AUDIT.md): self-review and an independent second review; every finding fixed or answered.
