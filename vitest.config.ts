// Written with AI help.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string): string => fileURLToPath(new URL(`./${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@paid-lock/core": src("packages/core"),
      "@paid-lock/protocols": src("packages/protocols"),
      "@paid-lock/probe": src("packages/probe"),
      "@paid-lock/mock-seller": src("fixtures/mock-seller"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "fixtures/*/test/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "fixtures/*/src/**/*.ts", "scripts/lib/**/*.ts"],
      exclude: ["**/*.test.ts", "packages/cli/src/bin.ts", "fixtures/mock-seller/src/main.ts", "scripts/lib/files.ts"],
      reporter: [["text", { skipFull: false }], "json-summary"],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
        "packages/core/src/**": { lines: 95, branches: 95, functions: 95, statements: 95 },
      },
    },
  },
});
