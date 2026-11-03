#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { main } from "./main.ts";

process.exitCode = await main(process.argv.slice(2), {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  isTTY: process.stdin.isTTY,
  prompt: async (question) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  },
});
