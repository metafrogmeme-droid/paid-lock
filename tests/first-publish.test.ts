// scripts/first-publish.sh against stub npm, pnpm and git on PATH: nothing reaches a registry or a remote.
// The stubs log every call; the real node and scripts/release-check.ts run as they would for the owner.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = resolve(ROOT, "scripts/first-publish.sh");
const ORDER = ["core", "protocols", "probe", "runtime", "cli"];

const STUBS: Record<string, string> = {
  npm: `echo "npm $*" >>"$STUB_LOG"
case "$1" in
  config) echo "\${STUB_REGISTRY-https://registry.npmjs.org/}" ;;
  whoami) if [ -n "\${STUB_USER-}" ]; then echo "$STUB_USER"; else echo "npm error code ENEEDAUTH" >&2; exit 1; fi ;;
  org) if [ -n "\${STUB_ORG_FAIL-}" ]; then exit 1; fi; echo "$4 - owner" ;;
  view)
    name=\${2%@*}
    case " \${STUB_PUBLISHED-} " in *" $name "*) echo "\${2##*@}"; exit 0 ;; esac
    if [ -n "\${STUB_VIEW_ERROR-}" ]; then echo "npm error code ETIMEDOUT" >&2; exit 1; fi
    echo "npm error code E404" >&2; exit 1 ;;
  publish) case "$2" in *"/\${STUB_PUBLISH_FAIL:-none}.tgz") echo "npm error code E403" >&2; exit 1 ;; esac ;;
esac`,
  pnpm: `echo "pnpm $*" >>"$STUB_LOG"
if [ "$1" = pack ]; then touch "$3/$(basename "$PWD").tgz"; fi`,
  git: `echo "git $*" >>"$STUB_LOG"
case "$1 \${2-}" in
  "status --porcelain") if [ -n "\${STUB_DIRTY-}" ]; then echo " M README.md"; fi ;;
  "rev-parse --abbrev-ref") echo "\${STUB_BRANCH-main}" ;;
  "rev-parse HEAD") echo aaaa ;;
  "rev-parse origin/main") echo "\${STUB_ORIGIN-aaaa}" ;;
esac`,
};

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "first-publish-"));
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  }
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string> = {}, input = "") {
  const log = join(dir, `log-${String(Math.random()).slice(2)}`);
  writeFileSync(log, "");
  const r = spawnSync("bash", [SCRIPT, ...args], {
    cwd: ROOT,
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env["PATH"] ?? ""}`,
      STUB_LOG: log,
      STUB_USER: "owner-test",
      ...env,
    },
  });
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
  const publishes = calls
    .filter((c) => c.startsWith("npm publish "))
    .map((c) => {
      const [, , tarball = "", ...flags] = c.split(" ");
      return `${/([^/]+)\.tgz$/u.exec(tarball)?.[1] ?? "?"} ${flags.join(" ")}`;
    });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls, publishes };
}

describe("scripts/first-publish.sh (one-time first publish, owner's machine)", () => {
  it("is a dry run by default: every check, then npm publish --dry-run in dependency order", () => {
    const r = run([]);
    expect(r.status).toBe(0);
    expect(r.publishes).toEqual(ORDER.map((p) => `${p} --access public --dry-run`));
    expect(r.stdout).toContain("release-check: OK (5 packages at 0.1.0, confirmed)");
    expect(r.stdout).toContain("dry run OK");
    const at = (prefix: string) => r.calls.findIndex((c) => c.startsWith(prefix));
    expect(at("npm whoami")).toBeLessThan(at("npm view"));
    expect(at("npm view")).toBeLessThan(at("pnpm check"));
    expect(at("pnpm check")).toBeLessThan(at("pnpm demo"));
    expect(at("pnpm demo")).toBeLessThan(at("pnpm pack"));
    expect(r.calls.filter((c) => c.startsWith("npm view "))).toEqual(
      ["@paid-lock/core", "@paid-lock/protocols", "@paid-lock/probe", "@paid-lock/runtime", "paid-lock"].map(
        (n) => `npm view ${n}@0.1.0 version`,
      ),
    );
  });

  it("publishes for real only with --publish and the typed confirmation, without --dry-run", () => {
    const r = run(["--publish"], {}, "publish 0.1.0\n");
    expect(r.status).toBe(0);
    expect(r.publishes).toEqual(ORDER.map((p) => `${p} --access public`));
    expect(r.stdout).toContain("as owner-test");
  });

  it("publishes nothing when the confirmation is wrong or missing", () => {
    for (const input of ["publish 0.1.1\n", "yes\n", ""]) {
      const r = run(["--publish"], {}, input);
      expect([r.status, r.publishes]).toEqual([1, []]);
      expect(r.stderr).toContain("not confirmed; nothing published");
    }
  });

  it("stops at the first failed publish: earlier packages are out, later ones are not tried", () => {
    const r = run(["--publish"], { STUB_PUBLISH_FAIL: "probe" }, "publish 0.1.0\n");
    expect(r.status).not.toBe(0);
    expect(r.publishes).toEqual(["core --access public", "protocols --access public", "probe --access public"]);
    expect(r.stdout).toContain("published @paid-lock/protocols@0.1.0");
    expect(r.stdout).not.toContain("published @paid-lock/probe@0.1.0");
  });

  it.each<[string, Record<string, string>, string]>([
    ["not logged in to npm", { STUB_USER: "" }, "not logged in to npm"],
    ["not a member of the npm organisation", { STUB_ORG_FAIL: "1" }, "not a member of the npm organisation paid-lock"],
    ["a version already on the registry", { STUB_PUBLISHED: "@paid-lock/probe" }, "@paid-lock/probe@0.1.0 is already"],
    ["the registry check failing for another reason", { STUB_VIEW_ERROR: "1" }, "could not check @paid-lock/core"],
    ["another registry", { STUB_REGISTRY: "https://npm.example.com/" }, "expected https://registry.npmjs.org/"],
    ["a dirty working tree", { STUB_DIRTY: "1" }, "the working tree has changes"],
    ["another branch", { STUB_BRANCH: "feature" }, "not on main"],
    ["main behind origin/main", { STUB_ORIGIN: "bbbb" }, "not equal to origin/main"],
  ])("stops before packing or publishing on %s", (_name, env, message) => {
    const r = run(["--publish"], env, "publish 0.1.0\n");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(message);
    expect(r.calls.some((c) => c.startsWith("pnpm pack") || c.startsWith("npm publish"))).toBe(false);
  });

  it("refuses unknown arguments", () => {
    expect(run(["--yes"]).status).toBe(2);
    expect(run(["--publish", "--publish"]).status).toBe(2);
  });

  it("never handles an npm token", () => {
    const text = readFileSync(SCRIPT, "utf8");
    expect(text).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|--otp/u);
  });
});
