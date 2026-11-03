// Optional sticky PR comment (CLAUDE.md §3 item 6; input `comment`, default false). Best effort:
// any failure is a warning and never changes the verdict. Needs `pull-requests: write` in the
// workflow when enabled; the token is sent only to GITHUB_API_URL and never logged.
import { readFileSync } from "node:fs";

export const COMMENT_MARKER = "<!-- paid-lock:verify -->";
/** GitHub's comment body limit is 65536 characters. */
export const MAX_COMMENT_CHARS = 65_000;
const MAX_PAGES = 10;
/** GitHub owner (alphanumeric or hyphen) / repository name (not "." or ".."). */
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;

type Env = Readonly<Record<string, string | undefined>>;
export type CommentResult = "created" | "updated" | "skipped" | "failed";

class HttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${String(status)}`);
    this.status = status;
  }
}

/** The pull request number of a `pull_request` event, from the runner's event file. */
export function pullRequestNumber(env: Env): number | undefined {
  if (env["GITHUB_EVENT_NAME"] !== "pull_request") return undefined;
  const path = env["GITHUB_EVENT_PATH"];
  if (path === undefined) return undefined;
  try {
    const event = JSON.parse(readFileSync(path, "utf8")) as { pull_request?: { number?: unknown } };
    const n = event.pull_request?.number;
    return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

function body(markdown: string): string {
  const full = `${COMMENT_MARKER}\n${markdown}`;
  if (full.length <= MAX_COMMENT_CHARS) return full;
  const note = "\n\n(truncated; the full report is in the job summary)";
  return full.slice(0, MAX_COMMENT_CHARS - note.length) + note;
}

/** Create or update this Action's one comment on the pull request. */
export async function postStickyComment(
  env: Env,
  token: string,
  markdown: string,
  log: (line: string) => void,
): Promise<CommentResult> {
  const pr = pullRequestNumber(env);
  if (pr === undefined || token === "") {
    log("::notice::paid-lock: no PR comment (not a pull_request event, or no token)");
    return "skipped";
  }
  const repo = env["GITHUB_REPOSITORY"] ?? "";
  if (!REPO.test(repo)) {
    log("::warning::paid-lock: could not post the PR comment (GITHUB_REPOSITORY is not owner/repo)");
    return "failed";
  }
  const api = (env["GITHUB_API_URL"] ?? "https://api.github.com").replace(/\/+$/, "");
  const call = async (method: string, path: string, payload?: unknown): Promise<unknown> => {
    const res = await fetch(`${api}${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "paid-lock-action",
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    if (!res.ok) throw new HttpError(res.status);
    return res.json();
  };
  try {
    let mine: number | undefined;
    for (let page = 1; page <= MAX_PAGES && mine === undefined; page += 1) {
      const list = (await call(
        "GET",
        `/repos/${repo}/issues/${String(pr)}/comments?per_page=100&page=${String(page)}`,
      )) as { id?: unknown; body?: unknown; user?: { type?: unknown } | null }[];
      // Only a bot-authored comment is ours to update: anyone can write the marker (audit L3).
      mine = list.find(
        (c) =>
          typeof c.body === "string" &&
          c.body.startsWith(COMMENT_MARKER) &&
          typeof c.id === "number" &&
          c.user?.type === "Bot",
      )?.id as number | undefined;
      if (list.length < 100) break;
    }
    if (mine === undefined) {
      await call("POST", `/repos/${repo}/issues/${String(pr)}/comments`, { body: body(markdown) });
      return "created";
    }
    await call("PATCH", `/repos/${repo}/issues/comments/${String(mine)}`, { body: body(markdown) });
    return "updated";
  } catch (err) {
    const why = err instanceof HttpError ? err.message : "request failed";
    log(`::warning::paid-lock: could not post the PR comment (${why}); the verdict is unchanged`);
    return "failed";
  }
}
