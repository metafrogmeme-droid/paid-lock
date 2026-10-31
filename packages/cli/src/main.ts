// Written with AI help.
/** Exit codes of `paid-lock verify` and every other command (CLAUDE.md §3 item 5). */
export const EXIT = { allowed: 0, blocked: 1, needsOk: 2, toolError: 3 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

export const VERSION = "0.0.0";

const COMMANDS = ["init", "add", "lock", "update", "verify", "diff", "explain"] as const;

const HELP = `Usage: paid-lock <command> [options]

Commands (arriving in milestone M3):
  init        create an empty paid.lock
  add <url>   probe an endpoint unpaid and pin its payment terms
  lock        refresh observed terms, keep your limits
  update <url> accept a reviewed change for one endpoint
  verify      check every endpoint against paid.lock
  diff        show what changed since paid.lock
  explain <code>  explain a reason code

Options:
  --help      show this help
  --version   show the version

paid-lock never pays, never signs and never loads a key.
`;

export function main(argv: readonly string[], io: Io): ExitCode {
  const [command] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    io.out(HELP);
    return EXIT.allowed;
  }
  if (command === "--version" || command === "-V") {
    io.out(`paid-lock ${VERSION}\n`);
    return EXIT.allowed;
  }
  if ((COMMANDS as readonly string[]).includes(command)) {
    io.err(`paid-lock: "${command}" is not available yet (scaffold build)\n`);
    return EXIT.toolError;
  }
  io.err(`paid-lock: unknown command "${command}" (see paid-lock --help)\n`);
  return EXIT.toolError;
}
