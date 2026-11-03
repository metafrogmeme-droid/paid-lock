// paid-lock CLI (CLAUDE.md §3 item 5). Probes unpaid, never pays, never signs, never loads a key.
import { parseArgs } from "node:util";
import {
  acceptObservation,
  decode,
  emptyLock,
  endpointKey,
  isReasonCode,
  lockDigest,
  MAX_TOLERANCE_BPS,
  newEndpoint,
  normalizeTerms,
  verifyUnpinned,
  type EndpointResult,
} from "@paid-lock/core";
import { probe, ProbeUrlError } from "@paid-lock/probe";
import { EXPLAIN } from "./explain.ts";
import { CliError, lockExists, readLock, writeLock } from "./files.ts";
import { renderResult, renderSummary } from "./render.ts";
import { checkEndpoint as check, EXIT, isFailOn, methodOf, runVerify, urlOf, type ExitCode } from "./run-verify.ts";

export { EXIT, type ExitCode } from "./run-verify.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  isTTY: boolean;
  prompt: (question: string) => Promise<string>;
}

export const VERSION = "0.0.0";

const HELP = `Usage: paid-lock <command> [options]

Commands:
  init                  create an empty paid.lock
  add <url>             probe an endpoint unpaid and pin its payment terms
  verify [url]          check endpoints against paid.lock (CI)
  diff [url]            show what changed since paid.lock (always exits 0)
  update <url> | --all  accept reviewed changes (rewrites observed terms, never your policy)
  explain <code>        explain a reason code
  digest                print the digest of paid.lock (for the runtime's expectedDigest pin)

Options:
  --lockfile <path>     default: paid.lock
  --method GET|POST     add: request method (default GET)
  --tolerance <n%>      add: allow price rises up to n% (0-100, whole number; default 0)
  --allow-private-network  add: allow a private, link-local or loopback address (recorded in the
                        endpoint's policy; refused by default)
  --fail-on <level>     verify: needs-ok (default: exit non-zero on Blocked and Needs your OK) or blocked
  --accept-change <code> update without a TTY: accept this reason code (repeat for each code)
  --json                machine-readable output
  --help, --version

Exit codes: 0 allowed, 1 blocked, 2 needs your OK, 3 tool error.
paid-lock never pays, never signs and never loads a key.
`;

const exitFor = (verdict: EndpointResult["verdict"]): ExitCode => EXIT[verdict];

function parseTolerance(value: string | undefined): number {
  if (value === undefined) return 0;
  const m = /^(\d{1,3})%?$/.exec(value);
  const pct = m?.[1] === undefined ? NaN : Number(m[1]);
  if (!Number.isInteger(pct) || pct * 100 > MAX_TOLERANCE_BPS)
    throw new CliError("--tolerance must be a whole percentage from 0 to 100");
  return pct * 100;
}

export async function main(argv: readonly string[], io: Io): Promise<ExitCode> {
  try {
    return await run(argv, io);
  } catch (e) {
    if (
      e instanceof CliError ||
      e instanceof ProbeUrlError ||
      e instanceof RangeError ||
      (e instanceof TypeError && "code" in e)
    ) {
      io.err(`paid-lock: ${e.message}\n`);
      return EXIT.toolError;
    }
    throw e;
  }
}

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      lockfile: { type: "string", default: "paid.lock" },
      method: { type: "string" },
      tolerance: { type: "string" },
      "allow-private-network": { type: "boolean", default: false },
      "fail-on": { type: "string", default: "needs-ok" },
      "accept-change": { type: "string", multiple: true, default: [] },
      all: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "V", default: false },
    },
  });
  const [command, target] = positionals;
  const path = values.lockfile;
  const print = (text: string, json: unknown): void => {
    io.out(values.json ? `${JSON.stringify(json, null, 2)}\n` : text);
  };
  if (values.version) {
    io.out(`paid-lock ${VERSION}\n`);
    return EXIT.allowed;
  }
  if (command === undefined || values.help) {
    io.out(HELP);
    return EXIT.allowed;
  }

  switch (command) {
    case "init": {
      if (lockExists(path)) throw new CliError(`${path} already exists`);
      writeLock(path, emptyLock());
      print(`created ${path}\n`, { created: path });
      return EXIT.allowed;
    }

    case "add": {
      if (target === undefined) throw new CliError("add needs a URL");
      const method = (values.method ?? "GET").toUpperCase();
      if (method !== "GET" && method !== "POST") throw new CliError("--method must be GET or POST");
      const toleranceBps = parseTolerance(values.tolerance);
      const lock = readLock(path);
      const key = endpointKey(method, target);
      if (Object.hasOwn(lock.endpoints, key))
        throw new CliError(`${key} is already in paid.lock (use paid-lock update)`);
      const allowPrivateNetwork = values["allow-private-network"];
      const { samples } = await probe(target, { method, allowPrivateNetwork });
      const result = verifyUnpinned(key, samples);
      const first = samples[0];
      const n = first?.kind === "terms" ? normalizeTerms(first.terms) : undefined;
      if (result.verdict !== "allowed" || n?.ok !== true) {
        print(renderResult(result, false), { added: false, result });
        return exitFor(result.verdict);
      }
      const candidate = {
        ...lock,
        endpoints: { ...lock.endpoints, [key]: newEndpoint(n.terms, { toleranceBps, allowPrivateNetwork }) },
      };
      writeLock(path, candidate);
      print(`${renderResult(result, false)}added to ${path}; review the diff before committing\n`, {
        added: true,
        result,
      });
      return EXIT.allowed;
    }

    case "verify":
    case "diff": {
      const failOn = values["fail-on"];
      if (!isFailOn(failOn)) throw new CliError("--fail-on must be needs-ok or blocked");
      const lock = readLock(path);
      const { results, summary, exitCode } = await runVerify(lock, {
        failOn,
        ...(target === undefined ? {} : { target }),
      });
      print(results.map((r) => renderResult(r, command === "diff")).join("") + renderSummary(summary), {
        summary,
        results,
      });
      return command === "diff" ? EXIT.allowed : exitCode;
    }

    case "update": {
      if ((target === undefined) === !values.all) throw new CliError("update needs a URL or --all");
      let lock = readLock(path);
      const keys = values.all ? Object.keys(lock.endpoints).sort() : [endpointKey("GET", target ?? "")];
      for (const k of keys)
        if (!Object.hasOwn(lock.endpoints, k)) throw new CliError(`${k} is not in paid.lock (use paid-lock add)`);
      let worst: ExitCode = EXIT.allowed;
      for (const key of keys) {
        const url = urlOf(key);
        const { result, terms } = await check(lock, methodOf(key), url);
        const codes = [...new Set(result.findings.map((f) => f.code))];
        const unacceptable = codes.filter((c) =>
          ["REQUIREMENTS_UNREADABLE", "ENDPOINT_NOT_402", "PROBE_TIMEOUT"].includes(c),
        );
        const unstable = result.findings.some((f) => f.tag === "unstable-samples");
        io.out(renderResult(result, true));
        if (codes.length === 0 && result.notes.length === 0) {
          io.out("  no change\n");
          continue;
        }
        if (terms === undefined || unacceptable.length > 0 || unstable) {
          io.err(`paid-lock: ${key}: nothing readable and stable to accept; paid.lock unchanged\n`);
          worst = Math.max(worst, exitFor(result.verdict)) as ExitCode;
          continue;
        }
        if (codes.length > 0) {
          const accepted = values["accept-change"].filter(isReasonCode);
          const missing = codes.filter((c) => !accepted.includes(c));
          const ok = io.isTTY
            ? (await io.prompt(`Type yes to accept these changes for ${key}: `)).trim() === "yes"
            : missing.length === 0;
          if (!ok) {
            if (!io.isTTY)
              io.err(
                `paid-lock: ${key}: not accepted; to accept without a TTY pass ${missing.map((c) => `--accept-change ${c}`).join(" ")}\n`,
              );
            worst = Math.max(worst, exitFor(result.verdict)) as ExitCode;
            continue;
          }
        }
        const next = acceptObservation(lock, key, terms);
        if (!next.ok) throw new CliError(next.reason);
        lock = next.lock;
        writeLock(path, lock);
        io.out(`  accepted; observed terms updated in ${path} (policy unchanged)\n`);
      }
      return worst;
    }

    case "digest": {
      const digest = lockDigest(readLock(path));
      print(`${digest}\n`, { lockfile: path, digest });
      return EXIT.allowed;
    }

    case "explain": {
      if (target === undefined) throw new CliError("explain needs a reason code");
      if (!isReasonCode(target)) {
        io.out(`${decode(target)}\n`);
        return EXIT.toolError;
      }
      print(`${decode(target)}\n\n${EXPLAIN[target]}\n`, {
        code: target,
        line: decode(target),
        explanation: EXPLAIN[target],
      });
      return EXIT.allowed;
    }

    default:
      throw new CliError(`unknown command "${command}" (see paid-lock --help)`);
  }
}
