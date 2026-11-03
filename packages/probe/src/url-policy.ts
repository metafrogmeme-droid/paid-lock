/** Thrown when a URL may not be probed. The message never echoes credentials, so it can be printed. */
export class ProbeUrlError extends Error {
  override readonly name = "ProbeUrlError";
}

const IPV4_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Loopback hosts may be probed over plain http (the local mock seller, tests, the demo). */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "[::1]") return true;
  const m = IPV4_LOOPBACK.exec(host);
  return m?.slice(1).every((octet) => Number(octet) <= 255) ?? false;
}

/**
 * Parse and check a URL before any request is made (CLAUDE.md §3 item 4):
 * https only, except plain http on loopback; no credentials in the URL; fragment dropped.
 */
export function checkProbeUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ProbeUrlError("not a valid absolute URL");
  }
  if (url.username !== "" || url.password !== "") {
    throw new ProbeUrlError("URL must not contain credentials");
  }
  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new ProbeUrlError("URL must use https (plain http is allowed on loopback only)");
  }
  url.hash = "";
  return url;
}
