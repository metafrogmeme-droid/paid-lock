// Written with AI help.
// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "action/dist/**", ".semgrep/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: ["./tsconfig.tooling.json"], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: false }],
      "no-eval": "error",
      "no-implied-eval": "off",
      "@typescript-eslint/no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
  {
    // The core is pure: no I/O, no clock, no randomness (CLAUDE.md §0, §4).
    // The runtime check is pure as well; load.ts is its only I/O.
    files: ["packages/core/src/**/*.ts", "packages/runtime/src/**/*.ts"],
    ignores: ["**/*.test.ts", "packages/runtime/src/load.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(node:)?(fs|http|https|net|child_process|dns|os|process|tls|dgram|worker_threads)(/.*)?$",
              message: "packages/core and the runtime check must stay free of I/O.",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", "fetch", "process", "setTimeout", "setInterval", "crypto"],
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "the pure core is deterministic: pass time in." },
        { object: "Math", property: "random", message: "the pure core is deterministic." },
      ],
    },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
