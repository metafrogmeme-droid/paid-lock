// Written with AI help.
// The GitHub Action (CLAUDE.md §3 item 6): runs the same verify as `paid-lock verify` and reports
// it as a job summary, SARIF, annotations and step outputs. Needs no secret and no write permission.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { ProbeUrlError } from "@paid-lock/probe";
import { CliError, EXIT, isFailOn, readLock, runVerify, VERSION } from "paid-lock";
import { postStickyComment } from "./comment.ts";
import { renderAnnotations, renderSarif, renderSummaryMarkdown } from "./render.ts";

type Env = Readonly<Record<string, string | undefined>>;

function input(env: Env, name: string, fallback: string): string {
  return (env[`INPUT_${name.toUpperCase()}`] ?? fallback).trim();
}

/** Resolve a workspace-relative path; refuse anything that leaves the workspace. */
function inWorkspace(workspace: string, path: string): string {
  const full = resolve(workspace, path);
  const rel = relative(workspace, full);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new CliError(`${path} must be inside the workspace`);
  return full;
}

/** Run the Action. Returns the process exit code: 0 pass, 1 blocked, 2 needs your OK, 3 tool error. */
export async function runAction(env: Env, workspace: string, log: (line: string) => void): Promise<number> {
  try {
    const lockfile = input(env, "lockfile", "paid.lock");
    const failOn = input(env, "fail-on", "needs-ok");
    const sarifPath = input(env, "sarif", "paid-lock.sarif");
    const comment = input(env, "comment", "false");
    if (!isFailOn(failOn)) throw new CliError("fail-on must be needs-ok or blocked");
    if (comment !== "true" && comment !== "false") throw new CliError("comment must be true or false");
    const lockPath = inWorkspace(workspace, lockfile);
    const lock = readLock(lockPath);
    const lockText = readFileSync(lockPath, "utf8");

    const run = await runVerify(lock, { failOn });
    for (const r of run.results) {
      log(r.key);
      for (const line of r.findings.length === 0 ? [r.line] : r.findings.map((f) => `${f.line} [${f.code}]`))
        log(`  ${line}`);
      for (const n of r.notes) log(`  note: ${n}`);
    }
    const { allowed, blocked, needsOk, verdict } = run.summary;
    log(`${String(allowed)} allowed, ${String(blocked)} blocked, ${String(needsOk)} needed your OK`);
    for (const a of renderAnnotations(run.results, lockfile, lockText)) log(a);

    const markdown = renderSummaryMarkdown(run.results, run.summary, lockfile);
    const summaryFile = env["GITHUB_STEP_SUMMARY"];
    if (summaryFile) appendFileSync(summaryFile, markdown);
    // Optional, off by default; best effort: never changes the verdict.
    if (comment === "true") await postStickyComment(env, input(env, "github-token", ""), markdown, log);
    if (sarifPath !== "")
      writeFileSync(
        inWorkspace(workspace, sarifPath),
        `${JSON.stringify(renderSarif(run.results, lockfile, lockText, VERSION), null, 2)}\n`,
      );
    const outputFile = env["GITHUB_OUTPUT"];
    if (outputFile) {
      appendFileSync(
        outputFile,
        `verdict=${verdict}\nallowed=${String(allowed)}\nblocked=${String(blocked)}\nneeds-ok=${String(needsOk)}\nsarif=${sarifPath}\n`,
      );
    }
    return run.exitCode;
  } catch (e) {
    if (e instanceof CliError || e instanceof ProbeUrlError || e instanceof RangeError) {
      const outputFile = env["GITHUB_OUTPUT"];
      if (outputFile) appendFileSync(outputFile, "verdict=error\n");
      log(`::error::paid-lock: ${e.message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`);
      return EXIT.toolError;
    }
    throw e;
  }
}
