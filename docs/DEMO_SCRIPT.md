<!-- Written with AI help. -->

# Demo script (`pnpm demo`)

Layout follows the demo-script idea of the `-claw-guard-near-` reference project: every step has an exact expected
result, and the run fails on any mismatch. Everything runs locally: the mock seller on loopback, no live endpoint,
no key, no payment. CI runs it on every PR.

`pnpm demo` builds the packages, then runs `scripts/demo.ts`. The script:

1. Starts the mock seller with three x402 v2 endpoints: `/forecast` (10000), `/quote` (25000) and `/news` (5000).
   All three use fake `payTo` test addresses and Base Sepolia (testnet) USDC.
2. In a temporary directory, runs the built `paid-lock` binary: `init`, then `add --allow-private-network` for each
   endpoint (the mock seller is on loopback, which is refused unless the lock entry opts in).
3. Commits `paid.lock` to a throwaway git repository.
4. Switches the mock seller's scenario for each step below and runs `paid-lock verify --json`. It checks the exit code
   and the reason codes.

| Step | Change (one endpoint)                        | Expected verdict            | Exit | Code                      |
| ---- | -------------------------------------------- | --------------------------- | ---- | ------------------------- |
| 1    | none (all three verified)                    | Allowed ×3                  | 0    | –                         |
| 2    | `/forecast` payTo swapped                    | Blocked by your rule        | 1    | `PAYTO_CHANGED`           |
| 3    | `/forecast` network swapped to `eip155:8453` | Blocked by your rule        | 1    | `NETWORK_CHANGED`         |
| 4a   | `/quote` price ×3                            | Blocked by your rule        | 1    | `PRICE_ABOVE_LOCK`        |
| 4b   | `/quote` price ÷2                            | Allowed: within your limits | 0    | – (reported as a note)    |
| 5    | `/news` `extra.version` changed only         | Needs your OK               | 2    | `TERMS_CHANGED_OTHER`     |
| 6    | `/news` answers 200 unpaid                   | Needs your OK               | 2    | `ENDPOINT_NOT_402`        |
| 7    | `/news` garbage `PAYMENT-REQUIRED`           | Blocked by your rule        | 1    | `REQUIREMENTS_UNREADABLE` |

Final line, exactly:

```
DEMO OK (4 allowed, 4 blocked, 2 needed your OK, 0 payments sent, 0 keys loaded)
```

- **0 payments sent:** the mock seller counted 0 requests carrying `PAYMENT-SIGNATURE`, `X-PAYMENT` or
  `Authorization: Payment`.
- **0 keys loaded:** the built CLI, probe, core and protocols contain no signing or key-loading call (never-pays
  scan). CI's dependency-allowlist check also confirms there is no wallet library.
- Any mismatch prints `DEMO FAILED (...)` and exits 1.

In step 3 the network changes but the token address stays the same. That keeps the step to a single change. With a
different token address as well, verify reports both `NETWORK_CHANGED` and `ASSET_CHANGED` (see `verify.test.ts`).
