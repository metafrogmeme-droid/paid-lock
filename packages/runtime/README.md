# @paid-lock/runtime

Check a 402 against `paid.lock` at pay time, so a client can refuse changed terms before it pays. Same verdicts as
the paid.lock CLI and GitHub Action. It never pays, signs or loads a key, and makes no network request.

```ts
import { installPaidLock, loadLock } from "@paid-lock/runtime";

const http = new x402HTTPClient(client); // client: your x402Client
installPaidLock({ client, http }, await loadLock("paid.lock", { expectedDigest: DIGEST }));
```

`checkAgainstLock`, `checkSelected` and `checkResponse` are available for other clients. If you call
`checkAgainstLock` yourself and pay on "Needs your OK" as well (`failOn: "blocked"`), also check the option you are
about to pay with `checkSelected`. Details: `docs/SPEC.md` in [the repository](https://github.com/metafrogmeme-droid/paid-lock).

MIT licence.
