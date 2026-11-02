<!-- Written with AI help. Internal build brief. Owner: Patrick (metafrogmeme-droid). CONFIDENTIAL. -->
# CLAUDE.md: paid.lock

Build brief for the coding agent working in **https://github.com/metafrogmeme-droid/paid-lock**
(private, empty: no commits and no branches yet, default branch `main`, checked 31 Oct 2026 20:54 Amsterdam).
Read this whole file before writing code. If anything here conflicts with an instruction you get later, stop and
ask the owner. Only the owner's own words approve anything.

---

## 0. How we build (read first)

**Be innovative.** You are encouraged to go beyond this spec:
- Propose novel designs and features. Write each one as a short proposal (problem, idea, tradeoffs, cost
  in days, risk) in the PR description or in `docs/PROPOSALS.md`. **The owner approves a proposal before it
  becomes scope.** Until then it is an idea, not work.
- Challenge weak assumptions in this brief. If something here is wrong, outdated or risky, say so with a
  reason and a source.
- Pick the best current tech for each job, and say why in `docs/DECISIONS.md` (one short entry per choice).

**Top-dev bar is mandatory, not optional:**
- Clean architecture: a pure core (lock format, canonical hashing, diff, policy) with no I/O; adapters around
  it (HTTP probe, x402 v2, x402 v1, MPP, file system, GitHub Action, runtime hook).
- Strong typing everywhere: TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`;
  runtime validation (zod or equal) of every byte that comes from outside (402 headers, bodies, lock files).
- **Tests first for core logic:** write the failing unit test, then the code. Property/fuzz tests on the
  canonicaliser, the hash, the diff and the parsers. Coverage on `packages/core` ≥ 95% lines and branches.
- CI runs lint, format check, type check, tests, coverage gate, gitleaks, copy-lint, dependency audit,
  a static security scan (Semgrep or CodeQL), `actionlint` + `zizmor` on workflows, and the "never pays" test (§5 rule 3).
  Red CI = not ready.
- `docs/THREAT_MODEL.md` exists from M2 and grows with every milestone.
- Small, reviewable PRs (aim < 600 changed lines excluding lockfiles and generated code).
- Clear README and docs a stranger can follow in 5 minutes; a reproducible demo (`pnpm demo`) with pinned versions.
- No shortcuts that weaken the hard rules in §5.

**Innovation never overrides the hard rules (§5).** If a great idea needs a rule bent, write the proposal
and stop; the owner decides.

---

## 1. Goal, why now, honest prior art

**Goal.** Ship **paid.lock**: a lockfile for the paid endpoints an AI agent calls. Think `package-lock.json`,
but for money. A `paid.lock` file committed in the agent's repo pins, per paid endpoint: the expected
`payTo`, network (CAIP-2), asset, scheme, maximum amount, and a canonical hash of the full payment terms.
- **CLI** (`paid-lock`): `init`, `add <url>`, `lock` / `update`, `verify`, `diff`, `explain`. It probes
  each endpoint **unpaid**, reads the 402 payment requirements, and writes or checks the lock. It never
  signs and never pays.
- **GitHub Action**: runs `verify` in CI (and on a schedule) and **fails the build when a seller changed
  `payTo`, network, asset or scheme, or raised the price above the lock**. Output is a readable PR comment /
  job summary + SARIF. Updating the lock is a normal, reviewable diff.
- **Runtime library** (`@paid-lock/runtime`, optional): `checkAgainstLock(lock, method, url, paymentRequired)`
  returns one of the three verdicts, so a client hook (Claw Pay's gate, or the official x402 client's before-payment hook)
  can refuse a changed `payTo` at pay time: "Blocked by your rule: payTo changed since paid.lock".

**Why now (sources, read 31 Oct 2026):**
- x402 v2 puts all terms in the 402 response, and the spec lists "Client-side budget management" as **out of
  scope** (x402 v2 spec, Document Scope). The client must bring its own checks.
  https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md
- x402 issue #2823 (open, July 2026, GoPlus Security author): "Payment-integrity verifier for 402 responses",
  a proposal for price ceiling, asset/chain, payTo consistency and allowlist checks before settlement. It is a
  guide + reference module proposal, not a lockfile and not a CI tool. https://github.com/x402-foundation/x402/issues/2823
- The owner's research page (31 Oct) cites ~25% of listed x402 endpoints rated dead or invalid (PulseFeed)
  and a 50,373-endpoint scan (fizzl). Terms and endpoints change; nobody reviews the change before agents pay.

**Prior art: be honest, the space is not empty.** Searches run 31 Oct 2026:
"x402 lockfile pin payTo endpoint CI GitHub Action detect price change", "x402 buyer agent pin payTo lock file
paid endpoints allowlist commit diff CLI", "settlens x402 agent buyers pin recipient lockfile", plus the research
page's search "x402 lockfile pin payTo address and max price per endpoint CI fails when seller changes payTo".
No tool named or shaped as a generated, committed, per-endpoint lockfile turned up. Close neighbours:

| Tool | What it does | Gap paid.lock fills |
|---|---|---|
| **Settlens** (settlens.com; CLI + GitHub Action + MCP; private repo, pilot only) | Seller-side and buyer-side x402 v2 scans against a hand-written policy (`schemes`, `networks`, `payTo`, `assets`, `maxAmount`), CI gate with SARIF, `monitor` with a state file, drift warning between two identical requests | Closed/pilot, not MIT. Policy is hand-written, not **generated from observation then pinned per endpoint** with a canonical terms hash; no lock-update review flow; x402 v2 only (no v1, no MPP). **Closest competitor: study its check catalog** (https://settlens.com/docs/checks) and do not copy text. |
| **x402 Endpoint Validator** (GitHub Marketplace) | Seller conformance: reachability, `/.well-known/x402`, 402 conformance, latency | No pinning, no drift vs a reviewed baseline |
| **x402 Manifest Check** (payloadhq, Marketplace) | Live 402 vs the seller's own `/.well-known/x402` manifest | Trusts the seller's manifest; a seller that changes both passes |
| **Taskmarket X402 Pay** | Local per-origin policy rules (`~/.taskmarket/x402-policy.json`) with exact recipient, enforced at pay time | Per-user, not a committed repo artefact; no CI |
| x402 client hooks (official `onBeforePaymentCreation` as described in PayAI x402-solana PR #39; Talos `onBeforeVerify`) | Places to plug a check in | Hooks only; paid.lock is the data + the check they can call |
| BANK OF AI x402 CLI | Global `--max-amount` caps | No per-endpoint payTo pin |

**Our edge (state it in the README):** (1) open source, MIT; (2) **trust-on-first-use then pin**, like SSH
`known_hosts` + `package-lock.json`: `paid-lock add` records what the seller offers today, a human reviews the
diff, and every later change is a reviewable diff, not a silent change; (3) one lock covers **x402 v2, x402 v1
and MPP** challenges; (4) the same lock is enforced in CI *and* at runtime; (5) SRI-style terms hash so any
drift (even in fields we don't model yet) is visible.

**Analogies to borrow from (cite in docs/DECISIONS.md):** `package-lock.json` / `pnpm-lock.yaml` (generated,
committed, deterministic), Subresource Integrity (`sha256-<base64>` integrity strings), SSH `known_hosts`
(TOFU + loud failure on change), Sigstore / npm provenance (signed artefacts; used for our own releases, and a
stretch idea for signed locks), GitHub's workflow-dependency lockfiles for Actions (same idea one layer down).

---

## 2. Protocol facts you must build on (verify again at build time; never invent field names)

### x402 v2 (spec: `specs/x402-specification-v2.md`, transport: `specs/transports-v2/http.md`)
- Server answers **HTTP 402** with header **`PAYMENT-REQUIRED`**: Base64-encoded JSON `PaymentRequired`.
  Client pays with `PAYMENT-SIGNATURE`; server answers with `PAYMENT-RESPONSE`. **paid.lock only ever reads
  `PAYMENT-REQUIRED`. It must never send `PAYMENT-SIGNATURE` or `X-PAYMENT`.**
- `PaymentRequired`: `x402Version` (must be 2), `error` (optional), `resource` (ResourceInfo, required),
  `accepts` (array, required), `extensions` (optional).
- `ResourceInfo`: `url` (required), `description`, `mimeType`, `serviceName`, `tags`, `iconUrl` (optional).
- Each `accepts[]` `PaymentRequirements`: `scheme`, `network` (CAIP-2, e.g. `eip155:84532`), `amount`
  (string, atomic units), `asset` (token address or ISO 4217 code for fiat), `payTo` (address **or role
  constant, e.g. "merchant"**), `maxTimeoutSeconds` (all required), `extra` (optional; protocol-reserved keys
  `assetTransferMethod` and `paymentFlow`, other keys scheme-specific, e.g. `name`, `version`).
- `paymentFlow` values: `authorization` (default), `upfront`, `escrow`. Spec: clients MUST NOT pay a flow
  they don't recognise → paid.lock pins `paymentFlow` and treats an unknown value as a change that needs review.
- Schemes in the spec tree: `exact`, `upto`, `batch-settlement`, `auth-capture`. **For `upto`, `amount` in
  the 402 is the *maximum* authorised**, so lock it as a max, not a price.
- Extensions are `{ info, schema }` objects keyed by name.

### x402 v1 (`specs/x402-specification-v1.md`; read-only compatibility)
- Body JSON `{ x402Version: 1, error, accepts }`; requirements use `maxAmountRequired` (not `amount`),
  network names like `base-sepolia` (not CAIP-2), plus `resource`, `description`, `mimeType`, `outputSchema`.
  Normalise v1 names to CAIP-2 through an explicit, tested table; unknown name → `UNREADABLE`, never a guess.

### MPP (Machine Payments Protocol, https://mpp.dev/protocol/challenges; IETF draft "The 'Payment' HTTP
Authentication Scheme", https://paymentauth.org/draft-httpauth-payment-01.pdf)
- 402 with `WWW-Authenticate: Payment id=…, realm=…, method=…, intent=…, request=…` (required) and
  `description`, `digest`, `expires`, `header`, `opaque` (optional). `request` is base64url JCS JSON with
  method-specific terms; common fields `amount`, `currency`, `recipient`.
- `id`, `expires`, `opaque` are per-challenge and change every time: never hash them. Pin `realm`, `method`,
  `intent` and the decoded `request` terms (`amount` as max, `currency`, `recipient`). MPP support is M5
  (read-only), behind a proposal if the method-specific schemas need more than this.

**Rule for the parser:** every field name in code must trace to one of these docs, with the doc URL + commit
SHA recorded in `docs/SPEC_SOURCES.md`. If the live docs differ from this brief, the docs win; open a
DECISIONS entry and tell the owner.

---

## 3. Scope

### MVP (must ship by M4, about one week)
1. **Lock format v1 (`packages/core`)**, pure TS, no I/O. Proposal for the shape (challenge it):
   ```json
   {
     "lockfileVersion": 1,
     "generatedBy": "paid-lock@0.1.0",
     "endpoints": {
       "GET https://api.example.com/v1/forecast": {
         "protocol": "x402",
         "x402Version": 2,
         "resourceUrl": "https://api.example.com/v1/forecast",
         "accepts": [
           {
             "scheme": "exact",
             "network": "eip155:84532",
             "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
             "payTo": "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
             "maxAmount": "10000",
             "observedAmount": "10000",
             "maxTimeoutSeconds": 60,
             "paymentFlow": "authorization",
             "assetTransferMethod": null
           }
         ],
         "termsIntegrity": "sha256-<base64 of SHA-256 over JCS of the normalised terms>",
         "lockedAt": "2026-11-02T10:00:00Z"
       }
     }
   }
   ```
   - Keys sorted, stable output, one trailing newline: re-running `lock` with no change is a no-op diff.
   - Canonicalisation: RFC 8785 JCS; EVM addresses compared case-insensitively but stored EIP-55 checksummed;
     non-EVM addresses compared exactly. Amounts are bigint strings, never floats.
   - `maxAmount` defaults to `observedAmount` (zero tolerance); owner may raise it per endpoint or set
     `--tolerance 10%` at add time. Price **drops** never fail.
   - Optional per-endpoint `allow` list for intentional multi-option sellers (several `accepts`).
2. **Verdicts and reason codes (stable enum; `decode(code)` returns only the 3 allowed strings):**
   `OK` → "Allowed: within your limits";
   `PAYTO_CHANGED`, `NETWORK_CHANGED`, `ASSET_CHANGED`, `SCHEME_CHANGED`, `PRICE_ABOVE_LOCK`,
   `PAYMENT_FLOW_CHANGED`, `RESOURCE_URL_MISMATCH`, `REQUIREMENTS_UNREADABLE`, `NOT_IN_LOCK` → "Blocked by your rule: …";
   `TERMS_CHANGED_OTHER` (hash differs only in un-modelled fields, e.g. `extra.name`, `maxTimeoutSeconds`),
   `NEW_OPTION_OFFERED`, `ENDPOINT_NOT_402` (answers 200/404/5xx unpaid), `PROBE_TIMEOUT` → "Needs your OK: …".
   Owner can tighten any "Needs your OK" to "Blocked" in config; nothing can loosen a "Blocked".
   **Fail closed:** anything unreadable or ambiguous is Blocked.
3. **Parsers (`packages/protocols`)**: x402 v2 (header), x402 v1 (body), MPP (`WWW-Authenticate`, M5).
   Size limits (header ≤ 128 KiB, body ≤ 1 MiB, JSON depth ≤ 64), strict Base64/Base64url, zod schemas.
   Fuzzed with malformed input. Consider reusing `@x402/core` types/parsers if they are small and pinned; say
   why in DECISIONS.
4. **Probe (`packages/probe`)**: unpaid request per endpoint, method from the lock (default GET; POST with a
   fixture body if configured). No redirects followed (report them), HTTPS required except loopback, timeout,
   2 samples to detect terms that change between identical requests, no cookies, no auth headers unless an
   allowlisted header **name** is configured (value from env, never written to the lock, logs or reports).
   **Never sends a payment header. Never loads a key. No wallet dependency in the probe package at all.**
5. **CLI (`packages/cli`, binary `paid-lock`)**: `init`, `add <url> [--method] [--tolerance]`, `lock`
   (refresh observed terms, keeps owner-set limits), `update <url>` (accept a change, prints the diff and asks
   for a typed `yes` on a TTY, refuses non-interactively unless `--accept-change <code>`), `verify`
   (exit 0 allowed / 1 blocked / 2 needs-your-OK / 3 tool error), `diff`, `explain <code>`, `--json` everywhere.
   Output uses only the three verdict strings.
6. **GitHub Action (`action/`)**: JS action (node24 runtime if available, else node20; check) bundled with
   `ncc`/`esbuild`, inputs `lockfile`, `fail-on` (`blocked` | `needs-ok`), `comment` (default off). Writes a
   job summary + SARIF; optional sticky PR comment. `permissions: contents: read` by default. Pin every third-
   party action by full SHA; run `zizmor`. Example workflows: `on: pull_request` + `on: schedule` (daily).
   Must not need any secret to run.
7. **Mock 402 server (`fixtures/mock-seller`)** for tests, CI and the demo: local only, serves x402 v2, v1 and
   (M5) MPP challenges from scenario files; it **never settles and has no facilitator**. Fixture addresses are
   obviously fake (e.g. `0x000000000000000000000000000000000000dEaD`-style or labelled test addresses);
   fixture tokens are never named like real assets unless they are the real **testnet** contract addresses
   copied from official docs (e.g. Base Sepolia USDC as in the x402 spec example), labelled "testnet".
8. **Demo** (`pnpm demo`): starts the mock seller, `paid-lock add` 3 endpoints, commits the lock, then flips
   scenarios and runs `verify`. Expected:
   1. unchanged → **Allowed** (3)
   2. `payTo` swapped → **Blocked** `PAYTO_CHANGED`
   3. network swapped to another chain → **Blocked** `NETWORK_CHANGED`
   4. price ×3 → **Blocked** `PRICE_ABOVE_LOCK`; price ÷2 → **Allowed**
   5. `extra.version` changed only → **Needs your OK** `TERMS_CHANGED_OTHER`
   6. endpoint answers 200 unpaid → **Needs your OK** `ENDPOINT_NOT_402`
   7. garbage header → **Blocked** `REQUIREMENTS_UNREADABLE`
   Ends with `DEMO OK (4 allowed, 4 blocked, 2 needed your OK, 0 payments sent, 0 keys loaded)` and exits
   non-zero on any mismatch. "0 payments sent" is asserted by the mock seller counting payment headers seen.

### After MVP
9. **Runtime library (`packages/runtime`, M5)**: `loadLock()`, `checkAgainstLock(lock, method, url, paymentRequired)`
   → `{ verdict, code, detail }` (lock passed in first: DECISIONS D-023, approved by the owner on 2 Nov 2026); adapters for the official x402 client's before-payment hook and for Claw Pay's
   gate (design note only until Claw Pay's x402 parser lands; no code in Claw-Pay from here).
10. **MPP read support (M5)**, as in §2.

### Stretch (only after M6 is green, each needs an approved proposal)
- Signed locks: `paid-lock sign` with Sigstore keyless in CI so a runtime can trust that the lock was reviewed.
- Seller-signed terms: compare against a seller's signed offer if the x402 Offer & Receipt extension
  (docs.x402.org/extensions/offer-receipt) is present; pin the signer.
- Bazaar import: seed a lock from `GET /discovery/resources` (still TOFU + review).
- MCP server (read-only `verify_endpoint`) for agents.
- Settlement audit: given a tx hash, check the payment went to the locked `payTo` (port the design of 001's
  receipt decoder, §4).

### Non-goals
- No paying, signing, wallets, keys, facilitators or `/settle` calls. Ever.
- No hosted service, no telemetry, no data leaves the user's CI except the unpaid probes.
- No token, price, presale or staking promos. No "is this seller trustworthy" scores.
- No LLM calls in CI or in the tool.

---

## 4. Architecture and reuse

```
paid.lock (committed) ──▶ core.verify(lock, observed) ─▶ verdict + reason code   ← pure, tested
                               ▲
probe (unpaid GET/POST, no keys) ─▶ protocols.parse(x402 v2 | v1 | MPP) ─▶ normalised terms
CLI ─┬─ add / lock / update (writes lock, human reviews diff)
     └─ verify ─▶ exit code, JSON, SARIF
GitHub Action ─▶ CLI verify ─▶ job summary / PR comment / SARIF
runtime lib ─▶ core.verify at pay time (Claw Pay gate, x402 client hook)
```

### Repo layout (pnpm workspace; adjust with a DECISIONS.md entry if you have a better one)
```
packages/core       lock schema, JCS canonicaliser, termsIntegrity, diff, reason codes, decode()
packages/protocols  x402 v2 / v1 parsers, MPP parser (M5), v1 network-name table
packages/probe      unpaid HTTP probe (undici), limits, no-redirect, 2-sample stability
packages/cli        paid-lock binary
packages/runtime    checkAgainstLock + hook adapters (M5)
action/             GitHub Action (bundled dist committed per Actions convention; CI checks dist is fresh)
fixtures/           mock-seller + scenario files (labelled "Written with AI help, test fixture")
docs/               SPEC, LOCK_FORMAT, ARCHITECTURE, THREAT_MODEL, DECISIONS, PROPOSALS, SPEC_SOURCES,
                    OPEN_QUESTIONS, AUDIT, RELEASE
.github/workflows/ci.yml
```

### Reuse plan (read-only references; port the design, rewrite the code, credit in README)
| Source (read-only) | What to reuse |
|---|---|
| `metafrogmeme-droid/Claw-Pay` → planned `packages/x402` (M2, may not exist yet) | Share the normalised `PaymentIntent` shape and reason-code style so the runtime lib plugs into Claw Pay's gate. If Claw Pay's parser isn't merged, write ours and propose one shared package later. |
| `metafrogmeme-droid/001` → `bot/grounded_reputation/decode.py`, `chains.py` | Settlement-receipt decoding (EIP-3009 `AuthorizationUsed` + `Transfer`, Permit2 proxy path). It decodes **receipts, not 402s**, so it only informs the stretch "settlement audit". 001 is BUSL-1.1: design only. |
| 001 → `scripts/guard_lint.py` | "is the check reached?" idea: a lint that every pay path in the runtime adapters calls `core.verify` |
| `metafrogmeme-droid/-claw-guard-near-` → `scripts/copy_lint.sh`, `scripts/gitleaks_selftest.sh`, `.gitleaks.toml` | copy-lint (three strings, banned words) and gitleaks self-test pattern |
| same → `docs/THREAT_MODEL.md`, `docs/DEMO_SCRIPT.md` | threat-model structure; demo script with exact expected counts |
| `metafrogmeme-droid/ARB` branch `m1-scaffold` (check status) | CI layout and `.githooks` as a template |

---

## 5. Hard rules (non-negotiable)

1. **MIT licence.** `LICENSE` (MIT, copyright 2026 Patrick Baur / RUNECLAW) in M1; `"license": "MIT"` in every
   package. No code copied from BUSL-1.1 sources (001, HashKeySeal) or from closed tools (Settlens); design only.
2. **No secrets in the repo, ever.** Probing needs none. Commit `.env.example` only if a config value is ever
   needed. gitleaks in CI and as a pre-commit hook, with a self-test.
3. **Never pay during probing.** Read the 402 only. No signing, no wallet, no private key, no
   `PAYMENT-SIGNATURE` / `X-PAYMENT` / `Authorization: Payment` header, no facilitator `/verify` or `/settle`
   call. Enforced by: (a) no wallet/signing dependency in `probe`, `cli`, `action` (dependency-allowlist test),
   (b) a test that greps the bundle for those header names in request code, (c) the mock seller failing the
   run if it ever sees a payment header.
4. **CI uses local/testnet fixtures only:** the mock 402 server on loopback. No live third-party endpoints
   in required CI jobs (an optional, non-blocking live smoke job against testnet sellers needs an approved proposal).
5. **Draft PRs only; the owner merges.** Never push to `main`, never force-push shared branches.
   **CI must be green before asking for review.**
6. **Check wording is only "Blocked by your rule: …", "Allowed: within your limits", "Needs your OK: …".**
   Never the words "safe" or "scam" (or "trusted"/"verified seller" claims) in UI, docs, CLI/Action output,
   README, marketplace text or posts. copy-lint enforces it (exclude this file and third-party identifiers).
7. **AI-written text is labelled "Written with AI help".**
8. **No token, price, presale or staking promos** anywhere. Endpoint prices in fixtures and the demo are fine.
9. **Publishing only after the owner's go in his own words:** no `npm publish`, no GitHub Marketplace listing,
   no release tags, no making the repo public. Opus prepares `docs/RELEASE.md`, `release.yml` (manual
   `workflow_dispatch`, npm provenance via OIDC, no long-lived npm token) and the Marketplace metadata only.
10. All config flags default off (`comment`, `live-smoke`, `allow-auth-header`, …).
11. Fail closed: unknown, unreadable or ambiguous terms are Blocked. Price drops never fail; price rises above
    the lock always do.
12. **Reference repos are read-only** (`Claw-Pay`, `-claw-guard-near-`, `ARB`, `001`). No PRs, issues or
    branches there. Copy no secrets, `.env` values, keys or private planning docs.
13. Never put passwords, codes or keys in PR text, issues, logs or chat. Probe reports never contain header
    values or response bodies.
14. Post drafts only in `docs/POST_DRAFT.md`, never published, no `@` handles; links in the first reply.

---

## 6. Milestones (each = branch + draft PR; CI green before asking for review)

| # | Target (Amsterdam) | Deliverable | Acceptance checks |
|---|---|---|---|
| M1 | Mon 2 Nov | Scaffold: pnpm workspace, TS strict, CI (lint/format/type/test/coverage/gitleaks/copy-lint/audit/Semgrep/actionlint/zizmor), pre-commit hook, MIT LICENSE, docs stubs incl. PROPOSALS/DECISIONS/SPEC_SOURCES, mock-seller skeleton serving one x402 v2 402 | CI green; gitleaks self-test passes; copy-lint catches a planted banned word; mock seller answers 402 with a valid `PAYMENT-REQUIRED` on loopback; dependency-allowlist test exists (no wallet libs) |
| M2 | Wed 4 Nov | Core: lock schema v1, JCS canonicaliser, `termsIntegrity`, diff, reason codes, `decode()`; x402 v2 + v1 parsers; `docs/LOCK_FORMAT.md`; THREAT_MODEL v1 | Tests first; unit ≥ 50 (each reason code pass + fail); property tests ≥ 6 (canonical hash stable under key order / address case; price drop never blocks; any payTo change always blocks; unreadable → Blocked; decode returns only the 3 strings; lock round-trip is byte-identical); core coverage ≥ 95%; parsers fuzzed |
| M3 | Fri 6 Nov | Probe + CLI (`init/add/lock/update/verify/diff/explain`, `--json`, exit codes) | No-redirect, HTTPS-only (loopback exempt), size/timeout limits tested; 2-sample instability → Needs your OK; `update` refuses non-interactive without `--accept-change`; **never-pays test** green (mock seller saw 0 payment headers); `pnpm demo` exits 0 with the DEMO OK line |
| M4 | Sun 8 Nov | **MVP:** GitHub Action (summary + SARIF + optional PR comment), example workflows (PR + daily schedule), README quick start | Action tested in this repo's own CI against the mock seller (pass case and each fail case); `dist/` freshness check; permissions `contents: read`; no secrets used; a stranger can follow README in < 5 min (owner checks) |
| M5 | Wed 11 Nov | Runtime lib + x402 client hook adapter + Claw Pay integration note; MPP read-only parser | Runtime returns identical verdicts to CLI on the shared fixture set (contract test); guard-reach lint; MPP fixtures: recipient/currency/amount changes caught, `id`/`expires`/`opaque` ignored |
| M6 | Fri 13 Nov | Audit + release prep: `docs/AUDIT.md` self-review + second opinion (Semgrep/CodeQL + separate reviewer), THREAT_MODEL final, `docs/RELEASE.md`, manual `release.yml` with npm provenance, Marketplace `action.yml` metadata, 0.1.0 changelog | All findings fixed or answered; `npm pack --dry-run` contents reviewed; nothing published. **Publish to npm / Marketplace and make public only after the owner's go** (owner runs it or approves the `workflow_dispatch`) |

If a milestone slips, cut MPP and the PR comment first. Never cut tests, the never-pays guarantee, audits or §5.

---

## 7. Open questions for the owner (answer before or during M1)

1. **Package names:** `paid-lock` (CLI) and scope `@paid-lock/*` (core/runtime)? Both were free on npm on
   31 Oct 2026; the scope needs an npm org you create. Or publish under your own scope?
2. **Default strictness:** zero price tolerance by default (any rise blocks), or a default like +10%?
3. **`TERMS_CHANGED_OTHER`:** fail CI by default (`fail-on: needs-ok`) or only warn (`fail-on: blocked`)?
4. **Settlens overlap:** OK to position paid.lock as the open, generated-lock alternative? Want a short
   comparison table in the README (facts only, no claims about them)?
5. **First real users / fixtures:** which of your own paid endpoints (Claw Pay check-api on Base Sepolia) should be
   the first real entry in an example lock once it exists?
6. **Hackathon/grant use:** enter it in UBC 2026 Agentic Payments (closes Fri 20 Nov; student eligibility
   unconfirmed) or Base Builder Grants after release? Or keep it as Claw Pay's supporting tool only?
7. **Repo visibility:** private now; public at the 0.1.0 release (needed for Marketplace)? Does this
   CLAUDE.md stay in the repo or move to private notes?
8. **Signed locks (stretch):** worth a proposal now, or after real users?

---

## 8. Working agreement

- Start each milestone with a short plan comment in the draft PR; end it with the acceptance checks pasted from CI.
- Keep `docs/OPEN_QUESTIONS.md`, `docs/DECISIONS.md`, `docs/PROPOSALS.md` and `docs/SPEC_SOURCES.md` current;
  don't guess on product, protocol or rule decisions.
- When blocked by a rule in §5, stop and ask. Do not work around it.
