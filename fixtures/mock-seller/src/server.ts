// Written with AI help, test fixture.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Route, Scenario } from "./scenario.ts";

/**
 * Request headers that carry a payment (x402 v2 transports-v2/http.md, x402 v1 transports-v1/http.md,
 * MPP "Payment" HTTP authentication scheme). paid.lock must never send any of them; the mock seller
 * counts every request that does and rejects it. It never settles and has no facilitator.
 */
export function carriesPayment(req: Pick<IncomingMessage, "headers">): boolean {
  const h = req.headers;
  if (h["payment-signature"] !== undefined || h["x-payment"] !== undefined) return true;
  const auth = h.authorization;
  return typeof auth === "string" && /^\s*payment\b/i.test(auth);
}

export interface MockSellerStats {
  requests: number;
  paymentHeadersSeen: number;
  challengesServed: number;
  /** Request header names seen (never values), sorted. */
  requestHeaderNames: string[];
}

export interface MockSeller {
  readonly origin: string;
  stats(): MockSellerStats;
  /** Switch to another scenario without restarting (same origin). */
  use(scenario: Scenario): void;
  close(): Promise<void>;
}

export interface MockSellerOptions {
  scenario: Scenario;
  host?: "127.0.0.1" | "::1";
  port?: number;
}

const LOOPBACK = new Set(["127.0.0.1", "::1"]);

function substituteOrigin(value: unknown, origin: string): unknown {
  if (typeof value === "string") return value.replaceAll("${origin}", origin);
  if (Array.isArray(value)) return value.map((v) => substituteOrigin(v, origin));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteOrigin(v, origin)]));
  }
  return value;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
  multi?: [name: string, values: string[]],
): void {
  if (multi !== undefined) res.setHeader(multi[0], multi[1]);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

/**
 * Sorted-key JSON. For the fixture's request objects (strings, integers, booleans, nested objects) this is
 * the JCS (RFC 8785) form MPP requires. Written here on purpose instead of using the core's canonicaliser,
 * so a bug there cannot hide behind the fixture.
 */
function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${sortedJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

type MppChallenge = Extract<Route["respond"], { kind: "mpp" }>["challenges"][number];

/** One `Payment` challenge; id, expires and opaque are new on every response (they are per challenge). */
function mppChallenge(c: MppChallenge, origin: string): string {
  const params: Record<string, string> = {
    id: randomBytes(16).toString("base64url"),
    realm: c.realm,
    method: c.method,
    intent: c.intent,
    expires: new Date(Date.now() + 5 * 60_000).toISOString().replace(/\.\d{3}Z$/u, "Z"),
    opaque: Buffer.from(sortedJson({ n: randomBytes(8).toString("hex") }), "utf8").toString("base64url"),
    request: Buffer.from(sortedJson(substituteOrigin(c.request, origin)), "utf8").toString("base64url"),
    ...(c.params ?? {}),
  };
  return `Payment ${Object.entries(params)
    .map(([k, v]) => `${k}="${v.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(", ")}`;
}

function respond(res: ServerResponse, route: Route, origin: string): void {
  const r = route.respond;
  switch (r.kind) {
    case "x402-v2": {
      const header = Buffer.from(JSON.stringify(substituteOrigin(r.paymentRequired, origin)), "utf8").toString(
        "base64",
      );
      sendJson(res, 402, {}, { "PAYMENT-REQUIRED": header });
      return;
    }
    case "x402-v1":
      sendJson(res, 402, substituteOrigin(r.body, origin));
      return;
    case "mpp":
      sendJson(res, 402, substituteOrigin(r.body ?? {}, origin), {}, [
        "WWW-Authenticate",
        r.challenges.map((c) => mppChallenge(c, origin)),
      ]);
      return;
    case "raw": {
      const headers = substituteOrigin(r.headers ?? {}, origin) as Record<string, string>;
      res.writeHead(r.status, { "cache-control": "no-store", ...headers });
      res.end(r.bodyBytes === undefined ? (r.body ?? "") : "x".repeat(r.bodyBytes));
      return;
    }
  }
}

/** Start the mock seller on loopback. It refuses any other bind address. */
export async function startMockSeller(options: MockSellerOptions): Promise<MockSeller> {
  const host = options.host ?? "127.0.0.1";
  if (!LOOPBACK.has(host)) throw new Error(`mock seller binds to loopback only, not ${host}`);
  const stats = { requests: 0, paymentHeadersSeen: 0, challengesServed: 0 };
  const headerNames = new Set<string>();
  let origin = "";

  const routesOf = (s: Scenario): Map<string, Route> => new Map(s.routes.map((r) => [`${r.method} ${r.path}`, r]));
  let routes = routesOf(options.scenario);
  const snapshot = (): MockSellerStats => ({ ...stats, requestHeaderNames: [...headerNames].sort() });

  const server = createServer((req, res) => {
    stats.requests += 1;
    for (const name of Object.keys(req.headers)) headerNames.add(name);
    if (carriesPayment(req)) {
      stats.paymentHeadersSeen += 1;
      sendJson(res, 400, { error: "mock seller: a payment header was sent; paid.lock must never pay" });
      return;
    }
    const path = new URL(req.url ?? "/", origin).pathname;
    if (req.method === "GET" && path === "/__mock/stats") {
      sendJson(res, 200, snapshot());
      return;
    }
    const route = routes.get(`${req.method ?? ""} ${path}`);
    if (route === undefined) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    const answer = (): void => {
      if (res.destroyed) return;
      respond(res, route, origin);
      if (route.respond.kind !== "raw") stats.challengesServed += 1;
    };
    if (route.delayMs === undefined) answer();
    else setTimeout(answer, route.delayMs).unref();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  origin = host.includes(":") ? `http://[${host}]:${String(port)}` : `http://${host}:${String(port)}`;

  return {
    origin,
    stats: snapshot,
    use: (scenario) => {
      routes = routesOf(scenario);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
        server.closeAllConnections();
      }),
  };
}
