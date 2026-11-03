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
zod-checked and must carry a "test fixture" label.

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

**D-020 The probe uses `node:http` / `node:https` with a pinned DNS lookup (replaces the transport in D-019).**
Owner decision of 2 Nov 2026: refuse private, link-local and loopback targets unless the lock entry opts in, with
tests for IPv4, IPv6 and DNS rebinding. Node's `fetch` offers no way to choose the address it connects to without the
`undici` package, so the probe now resolves the name itself (`dns.lookup`, all answers), checks every answer against
the IANA special-purpose ranges (`net.BlockList`, plus IPv4 inside NAT64 / 6to4 / mapped IPv6), and hands the request a
`lookup` function that returns exactly that address: no second resolution, so no rebinding window. TLS still verifies
the certificate against the host name (`servername`). Same limits and behaviour as before; fewer request headers
(`host`, `accept`, `user-agent`, `connection`). Still no new dependency.

**D-021 The GitHub Action: root `action.yml`, `node24`, one esbuild bundle, no `@actions/*` packages.** `action.yml`
sits at the repo root (needed for a Marketplace listing later) and runs `action/dist/index.mjs` on the `node24`
runtime. The source is `action/src`; `scripts/build-action.ts` bundles it with esbuild into one deterministic ESM
file, committed as Actions require, and CI rebuilds it and fails on any difference (`pnpm check:action-dist`). The
Action reuses the CLI's `runVerify`, so CLI and Action give identical verdicts. It writes the job summary, outputs
and annotations through the runner's files and workflow commands directly instead of `@actions/core`, which keeps the
bundle's dependencies to zod and @noble/hashes (both already allowlisted). Seller text is escaped for Markdown/HTML
and for workflow commands. SARIF 2.1.0 results point at the endpoint's line in `paid.lock`, with stable fingerprints.
The bundle is skipped by copy-lint and Semgrep (generated from scanned sources plus third-party code) but is
included in the never-pays scan and the dependency allowlist (`@paid-lock/action` is a guarded package).

**D-022 Optional sticky PR comment (input `comment`, default `false`).** One comment per pull request, found again by
a hidden marker and updated in place, built from the same escaped Markdown as the job summary (truncated below
GitHub's 65,536-character limit). It talks only to `GITHUB_API_URL` with the job's token, which is never logged;
redirects are refused. It is best effort: a refusal (for example a read-only token on a fork PR) is a warning and
never changes the verdict or the exit code. Enabling it needs `pull-requests: write`; the default stays
`contents: read`. No `@actions/*` package (plain `fetch`).

**D-023 Runtime library: the lock is passed in, two entry points, the whole 402 is checked.** Approved by the owner
on 2 Nov 2026; CLAUDE.md §1 and §3 item 9 updated to match. `@paid-lock/runtime`
exports `loadLock(path = "paid.lock")` and `checkAgainstLock(lock, method, url, paymentRequired)`, which returns
`{ verdict, code, detail, findings, notes }`. The brief's signature had no lock argument; passing the lock keeps the
check pure (no file read or global state per payment, easy to test) and lets a host load it once at start-up.
`paymentRequired` is what an x402 client has already decoded (the v2 header object or the v1 body); it goes through
the same guards as the raw forms (serialised to JSON text, then depth, size, duplicate-key and schema checks;
`parsePaymentRequired` in `packages/protocols`). `checkResponse(lock, method, url, { status, headers, body })` takes a
raw unpaid response instead, for fetch wrappers. Both call the core's `verifyEndpoint`, the same function as the CLI
and the Action; a contract test runs the shared fixture set (the demo's named changes) through the CLI and the
runtime and requires identical verdicts, reason codes, verdict lines and notes. The runtime checks the whole 402, as
CI does: one sample, since a client pays from one response (the CLI's two-sample check needs a second request).
Narrowing to the option the client selected is the hook adapter's job (M5 part 2). `code` is the first finding with
the worst verdict, so a host can branch on a stable code and show `detail`, which is always one of the three verdict
strings. The check never throws: an unreadable value, an unknown method or a URL that cannot be normalised is
Blocked. `loadLock` checks the size before reading, validates with `parseLock` and deep-freezes the result.

**D-024 x402 client adapter: two hooks, a re-check at pay time, no SDK dependency.** Read from
`x402-foundation/x402` @ `e208bd3` (`typescript/packages/core/src/client/x402Client.ts`,
`src/http/x402HTTPClient.ts`, `typescript/packages/http/fetch/src/index.ts`). The before-payment hook
(`onBeforePaymentCreation({ paymentRequired, selectedRequirements })`, can return `{ abort: true, reason }`) does not
see the request URL; the HTTP client's `onPaymentRequired({ paymentRequired, requestUrl })` does, but cannot abort.
Taking the URL from the 402's `resource.url` instead would let an endpoint that is not pinned copy a pinned
endpoint's terms and get paid under its entry (the payment would authorise a transfer the agent never reviewed for
that URL). So the adapter records `requestUrl` per 402 object (a `WeakMap`, nothing global) and, in the
before-payment hook, checks the whole 402 and the selected option (`checkSelected`: client policies may filter or
transform requirements) against the lock at that moment, then aborts with the worse verdict line unless `allows` says
yes. Checking again at pay time also catches changes made to the 402 object between the two hooks. A 402 the first
hook never saw throws, so a wiring mistake stops the payment instead of skipping the check. The adapter uses
structural types only: the dependency allowlist keeps `@x402/*` packages other than `@x402/core` out of shipped code,
and the runtime needs none. An integration test that runs the real client (with a stub scheme that never signs)
against the mock seller is planned as a dev-only test with `@x402/core` **2.29.0**, the version of `e208bd3`. That
version is younger than the repo's 7-day minimum release age until 4 Nov 2026 18:29 UTC; 2.28.0 has the same hook API
but depends on zod 3.25.76 (GHSA-mrhx-c7xc-m3w5, high, fixed only in zod >= 4.6.6), which would fail the audit. Rather
than loosening either control, the test lands once 2.29.0 is old enough.

**D-025 Guard-reach lint.** `pnpm check:guard-reach` (CI, `check` job) parses every adapter in
`packages/runtime/src/adapters/` with the TypeScript compiler API and fails unless every pay-path hook (names in
`PAY_PATHS`, today `onBeforePaymentCreation`) calls `checkAgainstLock`, `checkResponse` or `checkSelected`, directly or
through functions in the same file. A check that is only mentioned, not called, does not count, and an adapter file
with no known pay path fails, so a new adapter cannot skip the lint by using a new hook name. Idea from the
`001` repo's guard lint (design only, BUSL-1.1; code written fresh).

**D-026 Lock digest pin (P-04, approved by the owner on 2 Nov 2026).** `lockDigest(lock)` in the core is
`sha256-<base64>` over the RFC 8785 canonical JSON of the parsed lock, the same integrity form as the option hashes
(D-016). Hashing the parsed lock rather than the file bytes means formatting does not matter while every change to
observed terms, policy or the set of endpoints does. `paid-lock digest [--json]` prints it;
`loadLock(path, { expectedDigest })` in the runtime refuses a lock with another digest. The second argument is an
options object so later pins (for example a Sigstore bundle) can join it. `expectedDigest` is checked before the file
is read: an empty or malformed value throws instead of disabling the pin, because an unset environment variable must
not quietly turn the check off. The pin protects against edits to `paid.lock` on the agent's host, not against an
attacker who can also change where the digest is kept (THREAT_MODEL T26).

**D-027 MPP read support: challenges map onto the existing option fields.** Sources: SPEC_SOURCES, MPP section.
Each `WWW-Authenticate: Payment` challenge with intent `charge` becomes one option (LOCK_FORMAT, "MPP challenges as
options"), so identity matching, terms hashes, `maxAmount` and every reason code work unchanged, and the runtime and
the Action read MPP with no extra code. The lock gains `observed.protocol: "mpp"` (a discriminated union in the
schema; MPP entries have no `x402Version`). This is additive: existing x402 locks are byte-identical and
`lockfileVersion` stays 1. Choices, each fail closed:

- `network` is `mpp:<method>`: CAIP-2-shaped, but not a chain. A different method is `NETWORK_CHANGED`. A chain id
  inside `methodDetails` (Tempo's `chainId`) is pinned in `extra`, so a change is `TERMS_CHANGED_OTHER` (Needs your
  OK, can be tightened). Mapping it to Blocked needs `draft-evm-charge-00`, which has not been read.
- Without a `recipient` (optional for some methods), `payTo` is `realm:<realm>`, so a realm change is
  `PAYTO_CHANGED` (Blocked) instead of an "other" change.
- Only the `charge` intent is read; other intents are unreadable until their request schema is pinned.
- The `request` must be unpadded base64url of JSON already in JCS form (the draft's rule). Any other serialisation
  is refused, so two parsers cannot read different terms from one challenge (same reason as the duplicate-key rule).
- A 402 that offers both x402 terms (header or v1 body) and MPP challenges is unreadable: paid.lock cannot know which
  one the client will pay.
- `WWW-Authenticate` is parsed as an RFC 9110 challenge list (Node joins repeated headers with `", "`), with token68,
  quoted-pair and duplicate-parameter handling; other schemes such as `Bearer` are ignored.

**D-028 Fewer CI jobs, same checks (owner decision of 3 Nov 2026).** GitHub bills every job rounded up to a whole
minute plus its own setup and install, and the 17 jobs per run used up the Actions budget on 2 Nov. Now 6 jobs:
`check` (unchanged; runs every test with coverage on Node 24), `tests (node 22 and 26)` (one machine, two Node
versions, instead of a three-job matrix whose Node 24 leg repeated `check`), `action self-test (10 cases)` (the same
ten cases run in sequence in one machine, each with its own `uses: ./` step, and one final step that checks every
outcome and verdict output), `gitleaks`, `workflows`, `semgrep`. No check was dropped. Triggers were already
`push` to `main` only plus `pull_request`, so a PR push runs CI once.

**D-029 Release: manual workflow, five gates, npm trusted publishing.** `.github/workflows/release.yml` runs only on
`workflow_dispatch`, in a GitHub environment the owner approves, after `scripts/release-check.ts` (typed
confirmation `publish <version>`, matching versions, nothing private, MIT, CLI `VERSION`, CHANGELOG section) and a
full `pnpm check` plus demo. Packages are packed with `pnpm pack` (which rewrites `workspace:*` to real versions) and
published with `npm publish <tarball> --provenance` through npm trusted publishing (OIDC), so no npm token exists in
the repository or its settings, and every package carries provenance. Published in dependency order: core,
protocols, probe, runtime, CLI. The Action is released through a GitHub release and the Marketplace, not npm. The
workflow refuses today because every package is `"private": true`; a separate release PR flips that (docs/RELEASE.md).

**D-030 Claw Pay integration answers; locked and new value as data (owner decisions of 3 Nov 2026).** The owner
answered the two questions in docs/CLAW_PAY.md: (1) Claw Pay checks paid.lock for every seller by default; the owner
can turn it off per seller, and that choice is logged in the receipt; both gates run in Claw Pay's M3 and the
stricter outcome wins. (2) A paid.lock "Needs your OK" goes into Claw Pay's existing owner-OK queue, tagged with the
paid.lock reason code and the locked and new value; one queue, no second approval flow. For (2), every finding that
compares one value now carries `change: { locked, new }` (core `Finding`, runtime `LockCheck`, `verify --json`), so
the queue does not parse the verdict line. For `PRICE_ABOVE_LOCK`, `locked` is the locked maximum, because that is
the limit the price went over. Codes without one value to compare (`TERMS_CHANGED_OTHER`, `NEW_OPTION_OFFERED`,
`OPTION_REMOVED`, `NOT_IN_LOCK`, unreadable, not 402, timeout) have no `change`. Additive: no verdict, code or line
changes.
