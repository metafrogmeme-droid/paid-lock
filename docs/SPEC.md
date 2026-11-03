# paid-lock: commands, verdicts, exit codes

Lock file format: [LOCK_FORMAT.md](LOCK_FORMAT.md). paid-lock never pays, never signs and never loads a key; every
probe is a plain unpaid request (see THREAT_MODEL.md).

## Commands

| Command                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`                   | Creates an empty `paid.lock`. Refuses to overwrite an existing one.                                                                                                                                                                                                                                                                                                                                             |
| `add <url>`              | Probes the endpoint twice, unpaid. If both samples are readable and agree, pins them: `observed` = what was seen, `policy.maxAmount` = observed amount (+ `--tolerance`). Otherwise prints why and writes nothing.                                                                                                                                                                                              |
| `verify [url]`           | Probes every pinned endpoint (or one) twice and checks it against `observed` + `policy`. For CI.                                                                                                                                                                                                                                                                                                                |
| `diff [url]`             | Same as `verify` with reason codes shown; always exits 0 (3 on a tool error).                                                                                                                                                                                                                                                                                                                                   |
| `update <url>` / `--all` | Shows the changes and, once accepted, rewrites `observed` only. Your `policy` is never changed or removed; a new option gets a default entry. Accepting means typing `yes` on a terminal, or, without a terminal, passing `--accept-change <CODE>` for every reason code shown. Unreadable, missing, slow or unstable terms cannot be accepted. The brief's `lock` command is `update --all` (DECISIONS D-018). |
| `explain <code>`         | Prints the verdict line and an explanation for a reason code.                                                                                                                                                                                                                                                                                                                                                   |
| `digest`                 | Prints the digest of `paid.lock` (`sha256-<base64>` over its canonical JSON): the value for the runtime's `expectedDigest` pin. Exits 3 if the lock is missing or invalid.                                                                                                                                                                                                                                      |

Options: `--lockfile <path>` (default `paid.lock`), `--method GET|POST` (add), `--tolerance <n%>` (add, whole
percentage 0-100, default 0), `--allow-private-network` (add: allow a private, link-local or loopback address and
record that in the endpoint's policy; refused by default), `--fail-on needs-ok|blocked` (verify, default `needs-ok`), `--accept-change <CODE>`
(update, repeatable), `--json` (all commands).

## Exit codes

| Code | Meaning                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------- |
| 0    | Allowed: within your limits (also: `--fail-on blocked` and the worst verdict is Needs your OK) |
| 1    | Blocked by your rule                                                                           |
| 2    | Needs your OK (default `--fail-on needs-ok`)                                                   |
| 3    | Tool error: bad arguments, missing or invalid `paid.lock`, URL refused before any request      |

## What a 402 can carry

paid-lock reads three kinds of payment terms from an unpaid 402 (LOCK_FORMAT, DECISIONS D-027):

- **x402 v2:** the `PAYMENT-REQUIRED` header.
- **MPP:** `WWW-Authenticate: Payment` challenges, one option per challenge with intent `charge`. The fields that
  change on every challenge (`id`, `expires`, `opaque`, `digest`) are ignored, so the two probe samples still agree.
- **x402 v1:** the JSON body.

A 402 that offers both x402 and MPP terms is unreadable (Blocked), because paid-lock cannot know which one the client
will pay. The same lock entries, verdicts and exit codes apply to all three.

## Verdicts and reason codes

Output uses only "Allowed: within your limits", "Blocked by your rule: …" and "Needs your OK: …". Notes (for example
a price drop) change no verdict.

| Code                       | Verdict       |
| -------------------------- | ------------- |
| `OK`                       | Allowed       |
| `PAYTO_CHANGED`            | Blocked       |
| `NETWORK_CHANGED`          | Blocked       |
| `ASSET_CHANGED`            | Blocked       |
| `SCHEME_CHANGED`           | Blocked       |
| `PRICE_ABOVE_LOCK`         | Blocked       |
| `PAYMENT_FLOW_CHANGED`     | Blocked       |
| `RESOURCE_URL_MISMATCH`    | Blocked       |
| `REQUIREMENTS_UNREADABLE`  | Blocked       |
| `NOT_IN_LOCK`              | Blocked       |
| `TERMS_CHANGED_OTHER`      | Needs your OK |
| `NEW_OPTION_OFFERED`       | Needs your OK |
| `ENDPOINT_NOT_402`         | Needs your OK |
| `PROBE_TIMEOUT`            | Needs your OK |
| `PROTOCOL_VERSION_CHANGED` | Needs your OK |
| `OPTION_REMOVED`           | Needs your OK |

`policy.tighten` can turn any "Needs your OK" code into Blocked for one endpoint; nothing can loosen a Blocked code.

## Runtime library

`@paid-lock/runtime` (M5) checks a 402 against `paid.lock` at pay time with the same core check as the CLI and
the Action (DECISIONS D-023). It never pays, signs or loads a key, and it makes no network request.

| Function                                                      | Returns / does                                                                                                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadLock(path = "paid.lock", { expectedDigest })`            | The validated, deep-frozen lock. Throws `LockLoadError` (with `errors` from the schema) when the file is missing, too large or invalid, or when `expectedDigest` is set and the lock's digest differs (P-04). |
| `checkAgainstLock(lock, method, url, paymentRequired)`        | `{ verdict, code, detail, findings, notes }` for a PaymentRequired the client already decoded (x402 v2 header object or x402 v1 body). Never throws.                                                          |
| `checkResponse(lock, method, url, { status, headers, body })` | The same result for a raw unpaid HTTP response (header names in any case). Never throws.                                                                                                                      |

`verdict` is `allowed`, `blocked` or `needsOk`; `code` is the reason code of the first finding with that verdict
(`OK` when allowed); `detail` is the single verdict line ("Allowed: within your limits", "Blocked by your rule: …",
"Needs your OK: …"). An endpoint that is not in the lock, a method other than GET or POST, a URL that cannot be read
and unreadable terms are all Blocked. One response is checked (no second sample at pay time).

| Also exported                                                 | Returns / does                                                                                                                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkSelected(lock, method, url, paymentRequired, selected)` | Checks the one option the client is about to pay, as if the 402 offered only that option (pinned options not selected are not reported as removed). Never throws. |
| `allows(check, failOn = "needs-ok")`                          | Whether a check lets a payment go ahead: only Allowed by default; `"blocked"` also lets Needs your OK through (the CLI's `--fail-on`).                            |

### Lock digest pin (P-04)

`paid-lock digest` prints the digest of the reviewed lock. Set it at build or deploy time (for example as an
environment variable baked into the image, or a constant in the agent's code) and pass it to
`loadLock("paid.lock", { expectedDigest })`: a lock with any other digest is refused, so someone who can write
`paid.lock` on the agent's host cannot loosen it without also changing the deployed digest. The digest covers what
the lock says (the parsed lock as RFC 8785 canonical JSON), not its formatting. An empty or malformed
`expectedDigest` is an error, never "no pin". The pin is only as strong as the place the digest is kept.

### Adapter for the official x402 client

For `@x402/core`'s `x402Client` and `x402HTTPClient` (DECISIONS D-024). The adapter has no dependency on the SDK.

```ts
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { installPaidLock, loadLock } from "@paid-lock/runtime";

const client = new x402Client(); // register your schemes as usual
const http = new x402HTTPClient(client);
installPaidLock({ client, http }, await loadLock());
const fetchWithPayment = wrapFetchWithPayment(fetch, http); // pass `http`, the client the hooks are on
```

- `http.onPaymentRequired` records the URL the agent requested for each 402. It is the only x402 hook that sees the
  URL, and the URL must come from the request, not from the seller's 402.
- `client.onBeforePaymentCreation` runs right before a payment is created. It checks the whole 402 and the selected
  option against the lock at that moment, and aborts with the verdict line ("Blocked by your rule: …" or "Needs your
  OK: …") unless `allows` says yes. The x402 client then throws `Payment creation aborted: <line>`.
- A 402 that `onPaymentRequired` never saw throws `PaidLockHookError`: the payment stops (fail closed).
- Options: `method` (default `GET`; the x402 hooks do not carry the request method), `failOn` (default `needs-ok`),
  `onCheck({ url, check })` for logging. The URL is the one that answered 402 (after redirects, as the fetch wrapper
  reports it).

## Network targets

Before any request the probe checks where it would connect. Private (10/8, 172.16/12, 192.168/16, 100.64/10,
fc00::/7), link-local (169.254/16, fe80::/10), loopback (127/8, ::1) and other special-purpose addresses are refused
unless the endpoint's policy has `"allowPrivateNetwork": true`; IPv4 written inside IPv6 (mapped, NAT64, 6to4) is
judged by its IPv4 address. A host name is resolved once per request, every answer must pass, and the connection
goes to exactly the address that was checked, so a second DNS answer cannot redirect it (DNS rebinding). A refused
target is a tool error (exit 3) with the reason; nothing is sent. Endpoints that are not in `paid.lock` are never
probed (`NOT_IN_LOCK`).
