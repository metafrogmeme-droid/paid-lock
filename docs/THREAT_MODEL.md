<!-- Written with AI help. -->

# Threat model

Stub (M1); version 1 lands with M2 and grows each milestone. Already enforced in M1:

- **Accidental payment by the tool.** Dependency allowlist (no wallet or signing library), source scan for payment
  header names and signing calls, mock seller that counts payment headers. Each has a planted-violation test.
- **Secrets in the repo.** gitleaks over full history in CI, with a self-test; pre-commit hook.
- **Workflow supply chain.** Actions pinned by SHA, tools by checksum, `contents: read`, no persisted credentials,
  actionlint + zizmor.
- **Log spoofing by seller-controlled text.** Verdict details are forced onto one line.
