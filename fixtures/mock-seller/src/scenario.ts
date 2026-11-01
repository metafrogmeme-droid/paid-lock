// Written with AI help, test fixture.
import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * A scenario file describes what the mock seller answers per route. Payloads are served as-is
 * (not validated against x402) so scenarios can also hold malformed terms for negative tests.
 * The literal `${origin}` in any string is replaced at serve time.
 *   x402-v2: 402 + Base64 PAYMENT-REQUIRED header      x402-v1: 402 + JSON body
 *   raw:     any status, headers and body (200 unpaid, redirects, garbage headers, oversized bodies)
 */
const RespondSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("x402-v2"), paymentRequired: z.json() }),
  z.strictObject({ kind: z.literal("x402-v1"), body: z.json() }),
  z.strictObject({
    kind: z.literal("raw"),
    status: z.int().min(100).max(599),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    /** Serve this many filler bytes as the body (size-limit tests). */
    bodyBytes: z
      .int()
      .nonnegative()
      .max(16 * 1024 * 1024)
      .optional(),
  }),
]);

const RouteSchema = z.strictObject({
  method: z.enum(["GET", "POST"]),
  path: z.string().startsWith("/"),
  /** Wait before answering (timeout tests). */
  delayMs: z.int().nonnegative().max(60_000).optional(),
  respond: RespondSchema,
});

export const ScenarioSchema = z.strictObject({
  _label: z.string().includes("Written with AI help"),
  name: z.string().min(1),
  routes: z.array(RouteSchema).min(1),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
export type Route = Scenario["routes"][number];

export function parseScenario(json: unknown): Scenario {
  return ScenarioSchema.parse(json);
}

export async function loadScenario(path: string): Promise<Scenario> {
  return parseScenario(JSON.parse(await readFile(path, "utf8")));
}
