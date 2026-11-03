import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMMENT_MARKER, MAX_COMMENT_CHARS, postStickyComment, pullRequestNumber } from "./comment.ts";

interface Seen {
  method: string;
  url: string;
  auth: string | undefined;
  body: string;
}

let server: Server;
let api: string;
let seen: Seen[];
let existing: { id: number; body: string; user?: { type: string } }[];
let status: number;
let dir: string;

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) body += String(chunk);
  return body;
}

beforeEach(async () => {
  seen = [];
  existing = [];
  status = 200;
  server = createServer((req, res) => {
    void readBody(req).then((body) => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, body });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(req.method === "GET" ? JSON.stringify(existing) : JSON.stringify({ id: 99 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  api = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  dir = mkdtempSync(join(tmpdir(), "paid-lock-comment-"));
});
afterEach(async () => {
  await new Promise<void>((r) =>
    server.close(() => {
      r();
    }),
  );
  rmSync(dir, { recursive: true, force: true });
});

function prEvent(n: number): string {
  const path = join(dir, "event.json");
  writeFileSync(path, JSON.stringify({ pull_request: { number: n } }));
  return path;
}

const env = (extra: Record<string, string> = {}) => ({
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_EVENT_PATH: prEvent(7),
  GITHUB_REPOSITORY: "owner/repo",
  GITHUB_API_URL: api,
  ...extra,
});

describe("pullRequestNumber", () => {
  it("reads the PR number from the event file of pull_request events only", () => {
    expect(pullRequestNumber(env())).toBe(7);
    expect(pullRequestNumber(env({ GITHUB_EVENT_NAME: "push" }))).toBeUndefined();
    expect(pullRequestNumber({ GITHUB_EVENT_NAME: "pull_request" })).toBeUndefined();
  });
});

describe("postStickyComment", () => {
  it("creates one comment with the marker when there is none", async () => {
    const logs: string[] = [];
    const r = await postStickyComment(env(), "secret-token-value", "## paid.lock", (l) => logs.push(l));
    expect(r).toBe("created");
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "GET /repos/owner/repo/issues/7/comments?per_page=100&page=1",
      "POST /repos/owner/repo/issues/7/comments",
    ]);
    expect(seen[1]?.auth).toBe("Bearer secret-token-value");
    expect((JSON.parse(seen[1]?.body ?? "{}") as { body: string }).body).toBe(`${COMMENT_MARKER}\n## paid.lock`);
    expect(logs.join("\n")).not.toContain("secret-token-value");
  });

  it("updates its own earlier comment instead of adding another", async () => {
    existing = [
      { id: 1, body: "someone else" },
      { id: 42, body: `${COMMENT_MARKER}\nold`, user: { type: "Bot" } },
    ];
    expect(await postStickyComment(env(), "t", "new", () => undefined)).toBe("updated");
    expect(seen[1]).toMatchObject({ method: "PATCH", url: "/repos/owner/repo/issues/comments/42" });
  });

  it("never takes over a marker comment written by a person (audit L3)", async () => {
    existing = [{ id: 7, body: `${COMMENT_MARKER}\nplanted by a user`, user: { type: "User" } }];
    expect(await postStickyComment(env(), "t", "new", () => undefined)).toBe("created");
    expect(seen[1]).toMatchObject({ method: "POST" });
  });

  it("truncates a body that is too long for a GitHub comment", async () => {
    await postStickyComment(env(), "t", "x".repeat(MAX_COMMENT_CHARS * 2), () => undefined);
    const body = (JSON.parse(seen[1]?.body ?? "{}") as { body: string }).body;
    expect(body.length).toBeLessThanOrEqual(MAX_COMMENT_CHARS);
    expect(body).toContain("truncated");
  });

  it("skips when the event is not a pull request or there is no token", async () => {
    const logs: string[] = [];
    expect(await postStickyComment(env({ GITHUB_EVENT_NAME: "schedule" }), "t", "x", (l) => logs.push(l))).toBe(
      "skipped",
    );
    expect(await postStickyComment(env(), "", "x", (l) => logs.push(l))).toBe("skipped");
    expect(seen).toEqual([]);
    expect(logs.join("\n")).toContain("::notice::");
  });

  it("warns and does not throw when GitHub refuses (e.g. a fork PR with a read-only token)", async () => {
    status = 403;
    const logs: string[] = [];
    expect(await postStickyComment(env(), "t", "x", (l) => logs.push(l))).toBe("failed");
    expect(logs.join("\n")).toContain("::warning::paid-lock: could not post the PR comment (HTTP 403)");
  });

  it("refuses a repository name that is not owner/repo", async () => {
    for (const repo of ["../x", "owner/..", "owner", "own er/repo", "owner/repo/extra"]) {
      expect(await postStickyComment(env({ GITHUB_REPOSITORY: repo }), "t", "x", () => undefined)).toBe("failed");
    }
    expect(seen).toEqual([]);
  });
});
