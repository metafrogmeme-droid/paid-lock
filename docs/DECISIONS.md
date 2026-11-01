<!-- Written with AI help. -->

# Decisions

One entry per technical choice (CLAUDE.md §0). Format: decision, why, alternatives, revisit when.

**D-001 pnpm workspace, pnpm 10.28.0 pinned via `packageManager`.** Workspaces + strict node_modules (no
phantom deps, which the dependency allowlist relies on). `minimumReleaseAge: 10080` (7 days) and
`onlyBuiltDependencies` limit supply-chain exposure. pnpm 12 exists (Oct 2026) but is new to us; revisit after MVP.

**D-002 TypeScript 6.0, not 7.** TS 7.0 (native) is out, but typescript-eslint 8.72 supports `<6.1`, and typed
lint rules are part of the bar. Revisit when typescript-eslint supports TS 7. Settings: `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`,
`verbatimModuleSyntax`, `erasableSyntaxOnly`.

**D-003 Node >= 22.18, ESM only, native type stripping for scripts and fixtures.** Scripts and the mock seller
run as `.ts` with plain `node` (no tsx/ts-node dependency). Relative imports use `.ts` with
`rewriteRelativeImportExtensions` so the same source builds to JS for npm. CI tests on Node 22, 24 and 26.
Node 20 is end-of-life (Apr 2026).

**D-004 Vitest 5 + V8 coverage, fast-check for property tests.** Per-path thresholds: `packages/core` >= 95%
lines/branches/functions/statements; 90/85 elsewhere.

**D-005 zod 4 for runtime validation.** Strict objects at every boundary (402 headers, bodies, lock files,
scenario files). `@x402/core` (2.29.0) also depends only on zod; see D-011 for reuse.

**D-006 ESLint 10 flat config with typescript-eslint `strictTypeChecked` + `stylisticTypeChecked`.** The core has
lint rules that forbid I/O imports, `Date.now`, `Math.random`, `fetch`, timers (pure and deterministic).

**D-007 Security tools pinned by checksum, not by marketplace action.** gitleaks 8.30.1 and actionlint 1.7.12 are
downloaded from their GitHub releases and checked against SHA-256 values recorded in `ci.yml` (no
gitleaks-action, so no licence key). zizmor 1.31.1 and semgrep 1.183.0 are installed by exact version.
Locally: install gitleaks and run `pnpm hooks:install`; the pre-commit hook fails closed without gitleaks.

**D-008 Semgrep CE over CodeQL.** CodeQL on a private repository needs GitHub Code Security (paid). Semgrep runs
project rules (`.semgrep/paid-lock.yml`, with rule tests) plus the `p/javascript` and `p/typescript` packs.
Trade-off: registry packs are not version-pinned. Revisit CodeQL when the repo is public (free there).

**D-009 Actions pinned by full commit SHA.** Each SHA was checked two ways on 31 Oct 2026: the Go module proxy's
record of the tag (`proxy.golang.org/github.com/<owner>/<action>/@v/<tag>+incompatible.info`) and the
`action.yml` at that SHA on raw.githubusercontent.com. zizmor's online audits (impostor commits) run in CI.
Pinned: checkout v7.0.1, setup-node v7.1.0, pnpm/action-setup v6.1.0.

**D-010 Workspace packages resolve to source during development.** Each package exports a
`@paid-lock/source` condition pointing at `src/index.ts` (used by `tsc` via `customConditions`); Vitest uses
aliases. Published builds use `dist/`.

**D-011 Own fail-closed parsers; `@x402/core` as a test oracle, not a runtime dependency (proposed).** Our
parsers need size limits, strict Base64, depth limits and "unknown → Blocked" semantics, which a general SDK
does not promise. Plan for M2: add `@x402/core` as a devDependency and run a contract test that every fixture
our parser accepts is also accepted by its schemas (catches drift from the spec). Needs owner OK (OPEN_QUESTIONS).

**D-012 Audit exceptions are explicit.** `pnpm audit --audit-level low` gates CI. Any ignored advisory is listed in
`pnpm-workspace.yaml` `auditConfig.ignoreGhsas` with reason and re-check date. Current: GHSA-g3hv-75wg-m249
(minimatch < 11.0.1, moderate, dev-only via eslint; fix released 27 Oct 2026, not yet reachable from eslint's range).

**D-013 Lockfile analogies.** `package-lock.json` / `pnpm-lock.yaml` (generated, committed, deterministic, no-op
re-run), Subresource Integrity (`sha256-<base64>` strings), SSH `known_hosts` (trust on first use, loud
failure on change), Sigstore / npm provenance (signed release artefacts; stretch: signed locks), GitHub's
workflow dependency locking (same idea one layer down). Detailed format choices land with M2 (LOCK_FORMAT.md).

**D-014 Mock seller: `node:http`, loopback only, no framework.** Binds only to 127.0.0.1 or ::1 (runtime check).
Counts and rejects any request with a payment header; exits 1 at shutdown if it saw one. Scenario files are
zod-checked and must carry the AI-help label.

**D-015 Never-pays enforcement in layers.** (a) dependency allowlist, fail closed, plus a wallet/signing denylist
that the allowlist cannot override (`scripts/lib/deps.ts`); (b) source scan of shipped code for payment
header names, facilitator paths and signing calls (`scripts/lib/never-pays.ts`, also run on the action bundle
from M4); (c) mock seller counter. Each layer has a planted-violation test.

**D-016 Hashing in the pure core with `@noble/hashes`.** SHA-256 (integrity strings) and Keccak-256 (EIP-55
checksums) come from `@noble/hashes` 2.x: pure JS, audited, zero dependencies, synchronous, and it runs in
Node, browsers and edge runtimes, which the runtime library (M5) needs. Alternatives: `node:crypto` (ties the core
to Node and is an I/O-module import the core lint forbids), WebCrypto (async, no Keccak). The dependency
allowlist names it explicitly; the wallet denylist still blocks `@noble/curves` and `@noble/secp256k1`.

**D-017 Canonical JSON is RFC 8785, written in-house.** About 40 lines: ECMAScript number and string
serialisation (what RFC 8785 is defined by), keys sorted by UTF-16 code units, I-JSON enforced
(`String.prototype.isWellFormed`, finite numbers, plain objects), depth ≤ 64 containers. Tested against the
RFC's own examples plus property tests. A dependency would add supply-chain surface for little code.

**D-018 Owner decisions of 1 Nov 2026 for M3 (approved list #1-#11).** Implemented: fail on Blocked and on Needs your
OK by default (`--fail-on blocked` loosens); strict URL normalisation (#10); `OPTION_REMOVED` = Needs your OK (#11);
a price drop is Allowed and reported as a note (#2). Kept where the existing rule is stricter, as the owner allowed:
(a) the code stays `PRICE_ABOVE_LOCK` (brief §3 enum, shipped in M2) rather than `PRICE_INCREASED`; (b) an opt-in
tolerance is written into `policy.maxAmount` as an absolute cap at `add` time instead of a stored percentage, which
would rise with every accepted price increase. Consequence of P-01 ("only `update` rewrites observed"): the brief's
`lock` command is folded into `paid-lock update --all`.

**D-019 The probe uses Node's built-in `fetch`, not the `undici` package.** Node's `fetch` is undici, so the
brief's choice holds without adding a dependency to the allowlist. Settings: `redirect: "manual"` (never
followed, reported without the Location value), `AbortSignal.timeout` covering headers and body, a streamed body
cap, no cookie jar (Node's fetch has none), only `accept` / `user-agent` (+ `content-type` for POST) set. No
`cache` option: it makes fetch add `cache-control` / `pragma` headers, and Node's fetch does not cache anyway. A
test asserts the exact set of request header names the mock seller receives.
