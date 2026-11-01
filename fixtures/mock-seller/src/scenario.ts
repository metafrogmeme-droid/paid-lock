// Written with AI help, test fixture.
import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * A scenario file describes what the mock seller answers per route. The `paymentRequired`
 * object is served as-is (not validated against x402) so scenarios can also hold malformed
 * terms for negative tests. The literal `${origin}` in any string is replaced at serve time.
 */
const RouteSchema = z.strictObject({
  method: z.enum(["GET", "POST"]),
  path: z.string().startsWith("/"),
  respond: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("x402-v2"), paymentRequired: z.json() })]),
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
