#!/usr/bin/env bash
# Self-test for .gitleaks.toml (CLAUDE.md §5 rule 2).
# All key-shaped values are random, made at run time in a temp dir; nothing key-shaped is committed.
# Checks: an EVM private key in .env, JSON and TS forms and a 12-word mnemonic are reported; a
# public EVM address and a bare 32-byte hash (tx hash, digest) without a key name are not.
# Usage: bash scripts/gitleaks-selftest.sh   (GITLEAKS=/path/to/gitleaks to pick the binary)
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
gitleaks=${GITLEAKS:-gitleaks}
command -v "$gitleaks" >/dev/null || { echo "gitleaks-selftest: gitleaks not found (set GITLEAKS)" >&2; exit 2; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/hit" "$work/miss"

hex32() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
hex20() { od -An -N20 -tx1 /dev/urandom | tr -d ' \n'; }
words() { # 12 random lowercase "words" of 4-7 letters
  local out=() i
  for i in $(seq 12); do out+=("$(tr -dc 'a-z' </dev/urandom | head -c $((4 + RANDOM % 4)))"); done
  echo "${out[*]}"
}

echo "PRIVATE_KEY=0x$(hex32)" >"$work/hit/env.txt"
printf '{ "privateKey": "%s" }\n' "$(hex32)" >"$work/hit/cred.json"
printf 'const signerKey = "0x%s";\n' "$(hex32)" >"$work/hit/signer.ts"
printf 'MNEMONIC="%s"\n' "$(words)" >"$work/hit/mnemonic.txt"
printf '{ "payTo": "0x%s" }\n' "$(hex20)" >"$work/miss/address.json"
printf 'const txHash = "0x%s";\n' "$(hex32)" >"$work/miss/txhash.ts"

scan() { # scan <dir> -> "RuleID file" lines, sorted
  "$gitleaks" dir --config "$root/.gitleaks.toml" --no-banner --redact --exit-code 0 \
    --report-format json --report-path "$work/report.json" "$1" >/dev/null 2>&1
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")) ?? [];
    for (const f of r) console.log(f.RuleID, require("path").basename(f.File));
  ' "$work/report.json" | sort
}

fail=0
expect() { # expect <what> <actual> <expected>
  if [[ "$2" == "$3" ]]; then echo "gitleaks-selftest: ok   $1"; else
    echo "gitleaks-selftest: FAIL $1"; echo "  expected: $(tr '\n' ';' <<<"$3")"; echo "  actual:   $(tr '\n' ';' <<<"$2")"; fail=1
  fi
}

# Default rules (e.g. generic-api-key) may report some hits too; check that ours fire on each file.
expect "EVM private keys and a mnemonic are reported" "$(scan "$work/hit" | grep -E '^(evm-|wallet-)' || true)" "$(printf '%s\n' \
  "evm-private-key-assignment cred.json" "evm-private-key-assignment env.txt" \
  "evm-private-key-assignment signer.ts" "wallet-mnemonic-assignment mnemonic.txt")"
expect "a public address and a bare tx hash are not reported" "$(scan "$work/miss")" ""

if [[ $fail -ne 0 ]]; then echo "gitleaks-selftest: FAILED" >&2; exit 1; fi
echo "gitleaks-selftest: OK"
