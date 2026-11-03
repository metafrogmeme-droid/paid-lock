// Release gate (CLAUDE.md §5 rule 9, docs/RELEASE.md). Pure: the manual release workflow runs it before it
// packs or publishes anything, and it refuses unless every check passes.

/** Packages published to npm, in dependency order (core first, the CLI last). */
export const PUBLISHED = [
  "packages/core",
  "packages/protocols",
  "packages/probe",
  "packages/runtime",
  "packages/cli",
] as const;

export interface PackageInfo {
  dir: string;
  name: string;
  version: string;
  private?: boolean;
  license?: string;
}

export interface ReleaseInput {
  /** The version the owner asked to publish, e.g. 0.1.0. */
  version: string;
  /** What the owner typed to confirm; must be exactly `publish <version>`. */
  confirm: string;
  packages: PackageInfo[];
  /** The CLI's VERSION constant (packages/cli/src/main.ts). */
  cliVersion: string;
  changelog: string;
}

const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

/** Every reason the release must not go ahead; empty means all gates pass. */
export function checkRelease(r: ReleaseInput): string[] {
  const problems: string[] = [];
  if (!SEMVER.test(r.version)) problems.push(`version "${r.version}" is not X.Y.Z`);
  if (r.confirm !== `publish ${r.version}`) problems.push(`to confirm, type "publish ${r.version}" exactly`);
  for (const dir of PUBLISHED) {
    const p = r.packages.find((x) => x.dir === dir);
    if (p === undefined) {
      problems.push(`${dir} is missing`);
      continue;
    }
    if (p.private === true) problems.push(`${dir} is private (a release PR sets "private": false first)`);
    if (p.version !== r.version) problems.push(`${dir} has version ${p.version}, not ${r.version}`);
    if (p.license !== "MIT") problems.push(`${dir} is not MIT`);
  }
  if (r.cliVersion !== r.version) problems.push(`packages/cli VERSION is ${r.cliVersion}, not ${r.version}`);
  if (!r.changelog.split("\n").some((l) => l.trim() === `## ${r.version}`)) {
    problems.push(`CHANGELOG.md has no "## ${r.version}" section`);
  }
  return problems;
}
