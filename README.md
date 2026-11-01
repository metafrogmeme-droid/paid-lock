<!-- Written with AI help. -->

# paid.lock

A lockfile for the paid endpoints your AI agent calls. Like `package-lock.json`, but for money: `paid.lock`
pins, per endpoint, the `payTo`, network (CAIP-2), asset, scheme, maximum amount and a hash of the payment terms.
The `paid-lock` CLI reads each endpoint's 402 terms **without paying** and a GitHub Action fails CI when a seller
changes where the money goes or raises the price above your lock.

> **Status: M1 scaffold.** Nothing user-facing works yet. The CLI prints help; commands arrive in M3, the Action in
> M4. Nothing is published to npm or the Marketplace.

paid-lock never pays, never signs and never loads a key.

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
