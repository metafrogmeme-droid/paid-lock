# @paid-lock/probe

The unpaid HTTP probe of [paid.lock](https://github.com/metafrogmeme-droid/paid-lock): one plain request per sample,
HTTPS only (loopback excepted), no redirects followed, private and special-purpose addresses refused unless the lock
entry opts in, DNS answers pinned against rebinding, time and size limits. It never sends a payment, auth or cookie
header.

```ts
import { probe } from "@paid-lock/probe";
```

MIT licence.
