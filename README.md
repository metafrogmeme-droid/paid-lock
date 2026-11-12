# paid.lock

A lockfile for the paid endpoints your AI agent calls. Like `package-lock.json`, but for money: `paid.lock`
pins, per endpoint, the `payTo`, network (CAIP-2), asset, scheme, maximum amount and a hash of the payment terms.
The `paid-lock` CLI reads each endpoint's 402 terms (x402 v2, x402 v1 or MPP) **without paying** and a GitHub Action fails CI when a seller
changes where the money goes or raises the price above your lock.

> **Status: 0.1.1 is on npm** (`paid-lock`, `@paid-lock/core`, `@paid-lock/protocols`, `@paid-lock/probe`,
> `@paid-lock/runtime`), published by the release workflow with npm provenance. The GitHub Action is not on the
> Marketplace yet: reference it by commit SHA (below).

## Quick start

```sh
npx paid-lock@0.1.1 init
npx paid-lock@0.1.1 add https://seller.example/v1/forecast   # probes unpaid, pins the terms
git diff paid.lock                                            # review what you pinned
npx paid-lock@0.1.1 verify                                    # 0 allowed, 1 blocked, 2 needs your OK
```

Or install it in the project (`npm install --save-dev paid-lock@0.1.1`) and run `npx paid-lock …`. From a clone of
this repository: `pnpm install && pnpm build`, then `node packages/cli/dist/bin.js …`.

Commands, exit codes and reason codes: [docs/SPEC.md](docs/SPEC.md).

## GitHub Action

Add a workflow that runs the check on every pull request (full examples: [pull request](docs/examples/paid-lock-pull-request.yml),
[daily schedule](docs/examples/paid-lock-daily.yml)):

```yaml
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: metafrogmeme-droid/paid-lock@f57b774ba49cc9b6a71dd1f14875e0887f00c042 # 0.1.1
```

| Input      | Default           | Meaning                                                                           |
| ---------- | ----------------- | --------------------------------------------------------------------------------- |
| `lockfile` | `paid.lock`       | path inside the workspace                                                         |
| `fail-on`  | `needs-ok`        | `needs-ok` fails on Blocked and on Needs your OK; `blocked` fails on Blocked only |
| `sarif`    | `paid-lock.sarif` | where to write SARIF 2.1.0; empty for none                                        |
| `comment`  | `false`           | `true` keeps one comment with the report on the PR (needs `pull-requests: write`) |

Outputs: `verdict` (`allowed` / `blocked` / `needsOk`), `allowed`, `blocked`, `needs-ok`, `sarif`. The job summary lists every
endpoint with its verdict line, and each finding is annotated on its entry in `paid.lock`. The Action needs no secret,
only `contents: read`, and never pays: it sends plain unpaid requests, refuses private, link-local and loopback
addresses unless the lock entry opts in, and never follows redirects.

paid-lock never pays, never signs and never loads a key.

## Runtime check

`@paid-lock/runtime` (`npm install @paid-lock/runtime@0.1.1`) applies the same lock at pay time, so a client hook can
refuse changed terms before it pays. It reads terms only; it never pays, signs or loads a key.

With the official x402 client, two hooks do it (the payment is aborted with the verdict line):

```ts
import { installPaidLock, loadLock } from "@paid-lock/runtime";

const http = new x402HTTPClient(client); // client: your x402Client
installPaidLock({ client, http }, await loadLock()); // ./paid.lock, validated and frozen
const fetchWithPayment = wrapFetchWithPayment(fetch, http);
// a changed payTo now fails with "Payment creation aborted: Blocked by your rule: payTo changed since paid.lock"
```

To refuse a `paid.lock` that was edited on the host after review, pin its digest: `paid-lock digest` prints it, and
`loadLock("paid.lock", { expectedDigest })` refuses any other lock.

Or call the check yourself: `checkAgainstLock(lock, "GET", url, paymentRequired)` returns the verdict, reason code
and verdict line.

Details: [docs/SPEC.md](docs/SPEC.md#runtime-library).

## Develop

Requirements: Node >= 22.18, pnpm 10.28 (`corepack enable`), gitleaks 8.30.1 for the pre-commit hook.

```sh
pnpm install
pnpm hooks:install      # gitleaks + copy-lint + never-pays scan before each commit
pnpm check              # format, lint, types, tests + coverage, copy-lint, deps, never-pays, mock seller smoke
pnpm mock-seller        # local 402 seller on 127.0.0.1 (Ctrl-C prints its stats)
```

## Layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Choices and their reasons: [docs/DECISIONS.md](docs/DECISIONS.md).
Ideas waiting for a decision: [docs/PROPOSALS.md](docs/PROPOSALS.md). Protocol sources:
[docs/SPEC_SOURCES.md](docs/SPEC_SOURCES.md).

## Credits

- Protocol: the [x402 specification](https://github.com/x402-foundation/x402) (v2 and v1).
- The copy-lint and gitleaks self-test follow the design of the `-claw-guard-near-` project (same owner);
  the code here is written fresh.

## Licence

MIT, see [LICENSE](LICENSE).
