# @paid-lock/core

The pure core of [paid.lock](https://github.com/metafrogmeme-droid/paid-lock): the lock format, RFC 8785
canonical JSON, `sha256-<base64>` integrity strings, the verify logic and the reason codes. No I/O, no network,
no keys.

```ts
import { parseLock, verifyEndpoint } from "@paid-lock/core";
```

Most users want the CLI (`paid-lock`) or the GitHub Action; integrators who check payments at pay time want
`@paid-lock/runtime`. Lock format: `docs/LOCK_FORMAT.md` in the repository.

MIT licence.
