// Written with AI help.
// URL normalisation for endpoint keys and resource URLs (owner decision #10, 1 Nov 2026):
// lowercase scheme and host, drop the default port, drop the fragment; the path and query are kept
// byte for byte (no trailing-slash, dot-segment, percent-encoding or query rewriting), so any
// path or query difference is a mismatch. Input a WHATWG parser would silently repair
// (backslashes, whitespace, control characters) is refused instead.

export type UrlResult = { ok: true; value: string } | { ok: false; reason: string };

const DEFAULT_PORT: Readonly<Record<string, string>> = { "http:": "80", "https:": "443" };
const SCHEME_AUTHORITY = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)/;
const PRINTABLE = /^[\x21-\x7e\u0080-￿]+$/;

export function normalizeUrl(input: string): UrlResult {
  if (!PRINTABLE.test(input) || input.includes("\\")) {
    return { ok: false, reason: "URL has whitespace, control characters or backslashes" };
  }
  const m = SCHEME_AUTHORITY.exec(input);
  if (m === null) return { ok: false, reason: "not an absolute http(s) URL" };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "URL must be http or https" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "URL must not contain credentials" };
  if (url.hostname === "" || !authorityMatches(url, m[2] ?? "")) {
    return { ok: false, reason: "URL authority is empty or ambiguous" };
  }
  const port = url.port === "" || url.port === DEFAULT_PORT[url.protocol] ? "" : `:${url.port}`;
  const rest = input.slice(m[0].length).split("#", 1)[0] ?? "";
  return { ok: true, value: `${url.protocol}//${url.hostname}${port}${rest}` };
}

/** The authority as written must parse to the same host (e.g. "https:///x" would otherwise become host "x"). */
function authorityMatches(url: URL, authority: string): boolean {
  if (authority === "") return false;
  try {
    return new URL(`${url.protocol}//${authority}`).host === url.host;
  } catch {
    return false;
  }
}
