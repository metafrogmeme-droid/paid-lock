// Written with AI help. Semgrep rule tests: semgrep --test .semgrep (not compiled, not shipped).
// ruleid: paid-lock-no-redirect-follow
await fetch(url, { method: "GET", redirect: "follow" });
// ok: paid-lock-no-redirect-follow
await fetch(url, { method: "GET", redirect: "manual" });
// ruleid: paid-lock-no-child-process-in-packages
import { execFile } from "node:child_process";
// ruleid: paid-lock-no-dynamic-code
eval(code);
// ruleid: paid-lock-no-float-amounts
const n = Number(req.amount);
// ok: paid-lock-no-float-amounts
const b = BigInt(req.amount);
