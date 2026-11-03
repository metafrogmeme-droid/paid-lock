// Entry point of the bundled Action (action/dist/index.mjs). Never pays, never signs, needs no secret.
import { runAction } from "./run.ts";

process.exitCode = await runAction(process.env, process.env["GITHUB_WORKSPACE"] ?? process.cwd(), (line) => {
  process.stdout.write(`${line}\n`);
});
