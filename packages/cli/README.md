# paid-lock

A lockfile for the paid endpoints your AI agent calls. `paid.lock` pins, per endpoint, the payTo, network, asset,
scheme and maximum amount of its HTTP 402 terms (x402 v2, x402 v1 or MPP). The CLI reads the terms **without paying**;
`verify` fails when a seller changes where the money goes or raises the price above the lock.

```sh
npx paid-lock init
npx paid-lock add https://seller.example/v1/forecast   # probes unpaid, pins the terms
git diff paid.lock                                     # review what you pinned
npx paid-lock verify                                   # 0 allowed, 1 blocked, 2 needs your OK, 3 tool error
```

Output is only ever "Allowed: within your limits", "Blocked by your rule: …" or "Needs your OK: …". It never pays,
signs or loads a key. Docs, the GitHub Action and the runtime library: [the repository](https://github.com/metafrogmeme-droid/paid-lock).

MIT licence.
