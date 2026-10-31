// Written with AI help, test fixture.
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
}

export interface MockSeller {
  readonly origin: string;
  stats(): MockSellerStats;
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

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

/** Start the mock seller on loopback. It refuses any other bind address. */
export async function startMockSeller(options: MockSellerOptions): Promise<MockSeller> {
  const host = options.host ?? "127.0.0.1";
  if (!LOOPBACK.has(host)) throw new Error(`mock seller binds to loopback only, not ${host}`);
  const stats: MockSellerStats = { requests: 0, paymentHeadersSeen: 0, challengesServed: 0 };
  let origin = "";

  const routes = new Map<string, Route>(options.scenario.routes.map((r) => [`${r.method} ${r.path}`, r]));

  const server = createServer((req, res) => {
    stats.requests += 1;
    if (carriesPayment(req)) {
      stats.paymentHeadersSeen += 1;
      sendJson(res, 400, { error: "mock seller: a payment header was sent; paid.lock must never pay" });
      return;
    }
    const path = new URL(req.url ?? "/", origin).pathname;
    if (req.method === "GET" && path === "/__mock/stats") {
      sendJson(res, 200, stats);
      return;
    }
    const route = routes.get(`${req.method ?? ""} ${path}`);
    if (route === undefined) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    const paymentRequired = substituteOrigin(route.respond.paymentRequired, origin);
    const header = Buffer.from(JSON.stringify(paymentRequired), "utf8").toString("base64");
    stats.challengesServed += 1;
    sendJson(res, 402, {}, { "PAYMENT-REQUIRED": header });
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
    stats: () => ({ ...stats }),
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
