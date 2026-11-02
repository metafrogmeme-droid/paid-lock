<!-- Written with AI help. -->

# Architecture

Pure core, adapters around it (CLAUDE.md §4).

| Path                   | Role                                                                  | I/O                       |
| ---------------------- | --------------------------------------------------------------------- | ------------------------- |
| `packages/core`        | verdicts (M1); lock schema, JCS, integrity, diff, reason codes (M2)   | none (enforced by ESLint) |
| `packages/protocols`   | x402 v2 / v1 parsers (M2), MPP (M5)                                   | none                      |
| `packages/probe`       | URL policy (M1); unpaid HTTP probe (M3)                               | network, read-only        |
| `packages/cli`         | `paid-lock` binary (M3)                                               | files, network via probe  |
| `packages/runtime`     | pay-time check of a 402 against `paid.lock`; x402 client adapter (M5) | reads `paid.lock` only    |
| `action/`              | GitHub Action (M4)                                                    | GitHub job outputs        |
| `fixtures/mock-seller` | loopback-only 402 server for tests and the demo; never settles        | loopback only             |
| `scripts/`             | copy-lint, dependency allowlist, never-pays scan, gitleaks self-test  | repo files                |

Claw Pay's gate can enforce the same lock at pay time: see [CLAW_PAY.md](CLAW_PAY.md) (design note).
