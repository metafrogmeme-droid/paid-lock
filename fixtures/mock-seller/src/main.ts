// Written with AI help, test fixture.
// Usage: node fixtures/mock-seller/src/main.ts [scenario.json] [--port N]
// Prints `mock-seller listening <origin>` and serves until SIGINT/SIGTERM, then prints its stats
// as JSON and exits 1 if any request carried a payment header (CLAUDE.md §5 rule 3c).
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadScenario } from "./scenario.ts";
import { startMockSeller } from "./server.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { port: { type: "string", default: "0" } },
});
const scenarioPath = positionals[0] ?? fileURLToPath(new URL("../scenarios/baseline.json", import.meta.url));
const seller = await startMockSeller({ scenario: await loadScenario(scenarioPath), port: Number(values.port) });
process.stdout.write(`mock-seller listening ${seller.origin}\n`);

const stop = async (): Promise<void> => {
  const stats = seller.stats();
  await seller.close();
  process.stdout.write(`mock-seller stats ${JSON.stringify(stats)}\n`);
  process.exit(stats.paymentHeadersSeen === 0 ? 0 : 1);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
