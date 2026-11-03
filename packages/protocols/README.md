# @paid-lock/protocols

Read-only parsers for the payment terms of an HTTP 402: x402 v2 (`PAYMENT-REQUIRED` header), x402 v1 (JSON body)
and MPP (`WWW-Authenticate: Payment` challenges). Size, depth and duplicate-key limits; anything unreadable or
ambiguous is refused. Part of [paid.lock](https://github.com/metafrogmeme-droid/paid-lock). It never builds or sends
a payment credential.

```ts
import { observe402 } from "@paid-lock/protocols";
```

MIT licence.
