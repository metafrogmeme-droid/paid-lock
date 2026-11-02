<!-- Written with AI help. -->

# Proposals

Ideas only until the owner approves them (CLAUDE.md §0). Status: **open** unless marked.

## P-01 Lock format v1 revisions (decide before M2)

**Problem.** The draft format in CLAUDE.md §3 has four weak spots:

1. One `termsIntegrity` over all terms drifts on every probe for sellers that use the `sign-in-with-x` extension: it
   puts a fresh `nonce`, `issuedAt` and `expirationTime` into `PaymentRequired.extensions` on each 402
   (x402 `specs/extensions/sign-in-with-x.md`). Every verify would end in "Needs your OK".
2. `lockedAt` and `generatedBy` change without any change in terms (clock, tool upgrade), so re-running `lock` is
   not a no-op diff. Git already records when and by which commit the lock changed.
3. Owner-set limits (`maxAmount`, `allow`) and observed terms sit side by side; "`lock` keeps owner limits" is then a
   convention in code, not a property of the file.
4. `accepts[]` is matched by position, so a seller re-ordering options looks like a change.

**Idea.** Per endpoint: `policy` (owner-owned: `maxAmount` per option, `allow`, severity overrides) and
`observed` (tool-owned: normalised options, sorted by `(network, scheme, asset, payTo)`); one
`integrity` per option (SHA-256 over RFC 8785 JCS of the normalised option + `resource.url`); `extensions`
hashed separately with documented per-request fields removed, and an unknown extension change reported as
`TERMS_CHANGED_OTHER`. Drop `lockedAt` / `generatedBy`; keep `lockfileVersion`. Options are matched by
`(scheme, network, asset)`, then `payTo` and amount are compared.
Also: a `payTo` that is a role constant (e.g. `"merchant"`, allowed by the v2 spec) pins nothing, so `add`
reports it as "Needs your OK"; and `x402Version` is pinned (a v2 → v1 downgrade needs review).

**Trade-offs.** Slightly bigger file; two hashes to explain. Gains: no-op re-runs, no nonce noise, owner limits
cannot be overwritten by `lock`. **Cost** 0 extra days (it is the M2 format work). **Risk** low.
New reason code `PROTOCOL_VERSION_CHANGED` changes the §3 enum: owner decision.

## P-02 Look-alike hint on `PAYTO_CHANGED`

**Problem.** Address poisoning uses addresses that share first and last characters with a known one.
**Idea.** When `payTo` changes, the detail line says if the new address shares the first 4 and last 4 characters
with the locked one: "Blocked by your rule: payTo changed (new address matches the first 4 and last 4
characters of the locked one)". Verdict unchanged. **Cost** 0.5 d. **Risk** none to decisions (text only).

## P-03 Lock-update pull requests from the scheduled run

**Problem.** A daily scheduled `verify` only fails; someone still has to run `paid-lock lock` and open a PR.
**Idea.** Opt-in Action mode (default off) that, on drift, opens a PR with the proposed `paid.lock` diff and the
verdict lines, like Dependabot for paid endpoints. A human reviews and merges. **Trade-offs.** That workflow
needs `contents: write` and `pull-requests: write` (only in that example workflow; the verify job stays
read-only). **Cost** 1.5 d. **Risk** medium (write token); mitigated by a separate job and branch-only writes.

## P-04 Lock digest pin for the runtime

**Problem.** At pay time the runtime trusts whatever `paid.lock` is on disk.
**Idea.** `paid-lock digest` prints `sha256-<base64>` of the canonical lock; `loadLock({ expectedDigest })` refuses
a lock that does not match a value set at build or deploy time. A cheap step before Sigstore-signed locks.
**Cost** 0.5 d (M5). **Risk** low.

## P-05 Readable amounts in output only

**Idea.** Show "10000 (0.01 USDC, testnet)" next to atomic amounts, from a small decimals table copied from
official token docs and listed in SPEC_SOURCES. Decisions always use the atomic bigint. **Cost** 1 d.
**Risk** a wrong table entry misleads a reviewer; mitigated by labelling and sources.

## P-06 SARIF anchored to the lock entry

**Idea.** Each SARIF result points at the line of the endpoint's entry in `paid.lock`, so the PR shows the
annotation on the exact entry. **Cost** +0.5 d in M4. **Risk** low.

## P-07 `@x402/core` as a contract-test oracle (see DECISIONS D-011)

**Idea.** Dev-dependency only; a test checks that every fixture our strict parser accepts is also valid for
`@x402/core`'s schemas. **Cost** 0.5 d (M2). **Risk** low; adds a devDependency.

## P-08 Rotating-recipient sellers

**Problem.** Some sellers may hand out a fresh deposit address per request; the 2-sample check then always
reports instability. **Idea.** Report it once as "Needs your OK: payTo differs between identical requests"
and let the owner pin an explicit `allow` list of addresses for that endpoint; never a wildcard. **Cost** 0.5 d (M3).

## Follow-ups (deferred by the owner on 2 Nov 2026)

Not scope until the owner picks them up:

- **POST fixture bodies in the lock.** `add --method POST` probes without a body today. Storing a fixture body per
  endpoint needs a schema field (and a size limit) so `verify` can send the same body.
- **Allowlisted auth header.** Probe endpoints that require an API key before they answer 402: an allowlisted header
  name in config, the value read from an environment variable, never written to the lock, logs or reports
  (CLAUDE.md §3 item 4; default off).
- **Role-constant payTo at `add`.** A `payTo` that is a role constant (for example `"merchant"`, allowed by x402 v2)
  pins nothing; report it as "Needs your OK" when adding (from P-01).
