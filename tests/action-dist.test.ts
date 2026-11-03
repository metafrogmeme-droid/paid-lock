// action.yml runs a committed bundle: if it is not tracked by git, `uses:` fails for every user.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROOT } from "./run.ts";

describe("action.yml", () => {
  it("runs a file that is committed to git (not ignored)", () => {
    const main = /^\s*main:\s*(\S+)\s*$/m.exec(readFileSync(`${ROOT}/action.yml`, "utf8"))?.[1];
    expect(main).toBe("action/dist/index.mjs");
    const tracked = execFileSync("git", ["ls-files", "--", main ?? ""], { cwd: ROOT, encoding: "utf8" }).trim();
    expect(tracked).toBe(main);
  });
});
