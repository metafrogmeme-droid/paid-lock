# Release

Nothing is published until the owner says go in his own words (CLAUDE.md §5 rule 9). Claude prepares the
workflow, this runbook and the release PR; it never publishes, tags, makes the repository public or changes
repository settings. Status: **nothing published; the repository is private.** The release PR for 0.1.0 sets the five
published packages to `0.1.0` and `"private": false`; merging it publishes nothing (only the manual workflow below does).

## What a release publishes

| Where              | What                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| npm                | `@paid-lock/core`, `@paid-lock/protocols`, `@paid-lock/probe`, `@paid-lock/runtime`, `paid-lock` (the CLI), in that order |
| GitHub Marketplace | the Action (`action.yml` at the root, `action/dist` committed)                                                            |
| not published      | `@paid-lock/action` (ships through the Marketplace), `@paid-lock/mock-seller` (test fixture), the root workspace          |

## Gates (all must pass)

1. **Manual start.** `.github/workflows/release.yml` only runs on `workflow_dispatch`, started by the owner, who types
   the version and `publish <version>`.
2. **Owner approval.** The job runs in the `npm` environment, which has the owner as required reviewer.
3. **Release check** (`scripts/release-check.ts`, also runnable locally): version is `X.Y.Z`, the confirmation matches,
   every published package has that version, is not private and is MIT, the CLI's `VERSION` matches, and
   `CHANGELOG.md` has a `## X.Y.Z` section. With the 0.1.0 release PR merged it accepts `0.1.0` and refuses any other
   version.
4. **Full check and demo** run again inside the release job before anything is packed.
5. **No stored token.** npm trusted publishing (OIDC, `id-token: write`) authenticates the job, and npm records
   provenance linking each package to this repository, workflow and commit.

## One-time setup (owner)

1. **npm names.** Create the npm organisation `paid-lock` (owns the `@paid-lock` scope) and check that the unscoped
   name `paid-lock` is still free (both were on 31 Oct 2026; OPEN_QUESTIONS #1).
2. **Make the repository public.** The Marketplace requires it, and npm provenance is only issued for public
   repositories. Do this last, after the release PR is merged.
3. **GitHub environment `npm`** (Settings → Environments): required reviewer = owner; deployment branches = `main` only.
4. **Trusted publisher on npm** for each of the five packages: GitHub Actions, owner `metafrogmeme-droid`,
   repository `paid-lock`, workflow `release.yml`, environment `npm`. A package must exist on npm first, so 0.1.0 goes
   out once by hand: see "First publish (one time)" below. Never add an npm token to the repository or CI.

## First publish (one time)

Release run 42943216299 (0.1.0) stopped at `npm publish` with `E404` on `@paid-lock/core`. The reason: npm
trusted publishing cannot create a package that does not exist yet. Nothing was published. So the owner publishes
0.1.0 once from his own computer with `scripts/first-publish.sh`, and from 0.1.1 on the release workflow publishes
(DECISIONS D-031). The script uses only the owner's own `npm login` session: no npm token is created for this, and
none goes into the repository, its settings or CI.

1. **npm account and organisation.** Your npm account has two-factor authentication on (npmjs.com → Account →
   Two-Factor Authentication, "Authorization and writes"). The npm organisation `paid-lock` exists and your account is
   an owner of it.
2. **A clean checkout of `main`**, up to date, with Node ≥ 22.18 and pnpm (`corepack enable`):
   `git switch main && git pull && pnpm install --frozen-lockfile`.
3. **Log in to npm:** `npm login` (it opens the browser and asks for your second factor), then `npm whoami`.
4. **Dry run:** `bash scripts/first-publish.sh`. It stops at the first failed check, in this order: the registry is
   `https://registry.npmjs.org/`; the working tree is clean, on `main` and equal to `origin/main`; the release check
   (`scripts/release-check.ts`, as in the workflow); `npm whoami` and membership of the `paid-lock` organisation;
   none of the five packages is already on the registry at this version; `pnpm install --frozen-lockfile`,
   `pnpm check` and `pnpm demo`; then it packs each package with `pnpm pack` and runs
   `npm publish <tarball> --access public --dry-run` in dependency order. Read the file lists it prints. It ends with
   `dry run OK: 5 packages at 0.1.0 would be published`.
5. **Publish:** `bash scripts/first-publish.sh --publish`. The same checks run again; then type `publish 0.1.0` when
   asked. It publishes `@paid-lock/core`, `@paid-lock/protocols`, `@paid-lock/probe`, `@paid-lock/runtime` and
   `paid-lock` in that order with `--access public`; npm asks for your second factor as needed. It stops at the first
   error.
6. **Check:** `npm view <name>@0.1.0 version` prints `0.1.0` for each of the five. 0.1.0 has no provenance (npm only
   issues it from CI); 0.1.1 onwards will.
7. **Add a trusted publisher to each package** on npmjs.com (package → Settings → Trusted publishing), for each of
   `@paid-lock/core`, `@paid-lock/protocols`, `@paid-lock/probe`, `@paid-lock/runtime` and `paid-lock`:
   - Publisher: **GitHub Actions**
   - Organization or user: **metafrogmeme-droid**
   - Repository: **paid-lock**
   - Workflow filename: **release.yml**
   - Environment name: **npm**
8. **Then:** the GitHub release `v0.1.0` for the Marketplace (Release steps, step 4). From 0.1.1, use the Release
   steps below; the workflow publishes through the trusted publishers.

**If the publish stops part-way**, the packages already published stay published (npm does not take the same
version twice). Do not run the script again: it stops at "already on the registry". Publish the remaining packages by
hand, in the same order, from the same clean `main`, one at a time (replace `probe` with each remaining directory):
`d=$(mktemp -d) && (cd packages/probe && pnpm pack --pack-destination "$d") && npm publish "$d"/*.tgz --access public`.
Use `pnpm pack`, never a plain `npm publish` in the package folder: only `pnpm pack` turns `workspace:*` into `0.1.0`.

Credit: HUMANOID-TRADERS · RUNECLAW, Patrick Baur, CEO.

## Release steps

1. **Release PR** (Claude prepares, owner merges): versions `0.0.0 → X.Y.Z` in the five `package.json` files and in
   `packages/cli/src/main.ts` (`VERSION`), `"private": false` on those five, and a `## X.Y.Z` section in
   `CHANGELOG.md` (rename `## X.Y.Z (unreleased)` to `## X.Y.Z`). CI must be green; `node scripts/release-check.ts X.Y.Z "publish X.Y.Z"` must print OK.
2. **Publish** (owner; 0.1.0 is the one-time first publish above): Actions → release → Run workflow on `main`, enter `X.Y.Z` and `publish X.Y.Z`, approve the
   `npm` environment when asked.
3. **Check** (anyone): `npm view paid-lock@X.Y.Z` and `npm audit signatures` in a project that installs it show the
   version and its provenance.
4. **Marketplace** (owner): create the GitHub release `vX.Y.Z` from `main`, tick "Publish this Action to the GitHub
   Marketplace", and pick the categories. `action.yml` already carries the name, description, author and branding.
5. **Afterwards:** the Action can be referenced as `metafrogmeme-droid/paid-lock@<full commit SHA>` (recommended in the
   README examples) or `@vX.Y.Z`.

## If something goes wrong

- A bad npm version: `npm deprecate <pkg>@X.Y.Z "<reason>"` and publish a fixed `X.Y.Z+1`; npm only allows
  unpublishing a recent version under its own policy.
- A failed workflow before `Publish`: nothing reached npm; fix and run it again.
- A partial publish (some packages out): rerun with the same version fails for the ones already out; publish the
  rest by running the workflow again after a release PR that bumps only what is missing, or deprecate and bump all.
