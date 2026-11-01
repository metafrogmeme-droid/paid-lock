<!-- Written with AI help. -->

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

Options: `--lockfile <path>` (default `paid.lock`), `--method GET|POST` (add), `--tolerance <n%>` (add, whole
percentage 0-100, default 0), `--fail-on needs-ok|blocked` (verify, default `needs-ok`), `--accept-change <CODE>`
(update, repeatable), `--json` (all commands).

## Exit codes

| Code | Meaning                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------- |
| 0    | Allowed: within your limits (also: `--fail-on blocked` and the worst verdict is Needs your OK) |
| 1    | Blocked by your rule                                                                           |
| 2    | Needs your OK (default `--fail-on needs-ok`)                                                   |
| 3    | Tool error: bad arguments, missing or invalid `paid.lock`, URL refused before any request      |

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
