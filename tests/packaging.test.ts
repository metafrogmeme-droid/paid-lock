import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLISHED } from "../scripts/lib/release.ts";
import { ROOT } from "./run.ts";

interface Manifest {
  name: string;
  license?: string;
  files?: string[];
  repository?: { type?: string; url?: string; directory?: string };
  exports?: Record<string, Record<string, string>>;
  publishConfig?: { access?: string; exports?: Record<string, Record<string, string>> };
}

const manifest = (dir: string): Manifest =>
  JSON.parse(readFileSync(resolve(ROOT, dir, "package.json"), "utf8")) as Manifest;

describe("published packages (M6 packaging review)", () => {
  it.each(PUBLISHED)("%s ships the MIT licence text, a README and repository metadata", (dir) => {
    expect(readFileSync(resolve(ROOT, dir, "LICENSE"), "utf8")).toBe(readFileSync(resolve(ROOT, "LICENSE"), "utf8"));
    expect(existsSync(resolve(ROOT, dir, "README.md"))).toBe(true);
    const m = manifest(dir);
    expect(m.license).toBe("MIT");
    expect(m.repository).toEqual({
      type: "git",
      url: "git+https://github.com/metafrogmeme-droid/paid-lock.git",
      directory: dir,
    });
  });

  it.each(PUBLISHED)("%s publishes exports without the repo-only source condition, and no source maps", (dir) => {
    const m = manifest(dir);
    expect(m.publishConfig?.access).toBe("public");
    const published = JSON.stringify(m.publishConfig?.exports ?? {});
    expect(published).toContain("./dist/index.js");
    expect(published).not.toContain("@paid-lock/source");
    expect(published).not.toContain("./src/");
    expect(m.files).toContain("!dist/**/*.map");
  });
});
