# Changelog

All notable changes. Versions follow semantic versioning. The release PR renames a heading such as
`## 0.1.0 (unreleased)` to `## 0.1.0`; the release check only accepts the plain form (docs/RELEASE.md).

## 0.1.0 (unreleased)

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

### Security

- Never pays, signs or loads a key: dependency allowlist, a source scan for payment headers and signing calls, and a
  mock seller that counts payment headers in every end-to-end test (always 0).
- Audit before release (docs/AUDIT.md): self-review and an independent second review; every finding fixed or answered.
