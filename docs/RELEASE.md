# Release

Nothing is published without the owner's go in his own words (CLAUDE.md §5 rule 9). Claude prepares the workflow,
this runbook and the release PRs; it never publishes, tags, creates releases or changes repository settings.

## Status (12 Nov 2026)

**0.1.1 is published** by the release workflow, through npm trusted publishing (OIDC, no npm token) with provenance.
0.1.0 was published once by hand (see "First publish (one time)").

| Item                                                                                                  | State                                                                                                                                                                                                                                                                                                                                                                                                               | How it was checked                                                   |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| npm `paid-lock`, `@paid-lock/core`, `@paid-lock/protocols`, `@paid-lock/probe`, `@paid-lock/runtime`  | `latest` = `0.1.1` for all five; versions on npm: `0.0.0-stage`, `0.1.0`, `0.1.1`                                                                                                                                                                                                                                                                                                                                   | `npm view` (public registry)                                         |
| Provenance for 0.1.1                                                                                  | SLSA v1 provenance on all five, naming `metafrogmeme-droid/paid-lock`, `.github/workflows/release.yml`, `refs/heads/main`                                                                                                                                                                                                                                                                                           | npm attestations API, statements decoded                             |
| How 0.1.1 went out (11 Nov 2026, UTC)                                                                 | the four libraries at 15:23 to 15:24 by release run 43045910266 (attempt 2) on `d839079` (after #37); `paid-lock` (the CLI) at 15:34 by release run 43049107915 on `f57b774` (after #38, which skips packages already on the registry). Run 43044308338 on `6f074ae` failed before publishing (fixed by #37). The package code is the same in both commits: only the release workflow and docs changed between them | provenance statements (commit and run per package), Actions run list |
| Trusted publishers (GitHub Actions, `metafrogmeme-droid/paid-lock`, `release.yml`, environment `npm`) | verified: npm accepted the OIDC publish and issued provenance for all five                                                                                                                                                                                                                                                                                                                                          | follows from the two rows above                                      |
| GitHub environment `npm`                                                                              | the owner is the required reviewer; only `main` may deploy                                                                                                                                                                                                                                                                                                                                                          | owner's check with the GitHub API                                    |
| Repository visibility                                                                                 | public                                                                                                                                                                                                                                                                                                                                                                                                              | repository page and API, without credentials                         |
| Git tag and GitHub release for 0.1.1                                                                  | not created (`v0.1.0` = `5a87659` is the only tag)                                                                                                                                                                                                                                                                                                                                                                  | `git ls-remote --tags`                                               |
| Marketplace listing of the Action                                                                     | not yet; the README and `docs/examples/` pin the Action by the full commit SHA `f57b774`                                                                                                                                                                                                                                                                                                                            | owner's step (Release steps, step 4)                                 |
| 0.1.0 (history)                                                                                       | published 11 Nov 2026 by the owner from `main` at `5a87659`, no provenance; GitHub release `v0.1.0`                                                                                                                                                                                                                                                                                                                 | recorded in the 11 Nov status (git history of this file)             |

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
   `CHANGELOG.md` has a `## X.Y.Z` section. It accepts only the version the repository is at (after a release PR is
   merged, that release's version) and refuses any other.
4. **Full check and demo** run again inside the release job before anything is packed.
5. **No stored token.** npm trusted publishing (OIDC, `id-token: write`) authenticates the job, and npm records
   provenance linking each package to this repository, workflow and commit.

## One-time setup (owner)

1. **npm names** (done 11 Nov 2026: the five names are published). Create the npm organisation `paid-lock` (owns the `@paid-lock` scope) and check that the unscoped
   name `paid-lock` is still free (both were on 31 Oct 2026; OPEN_QUESTIONS #1).
2. **Make the repository public** (done 11 Nov 2026, after 0.1.0 was published). The Marketplace requires it, and npm provenance is only issued for public
   repositories. Do this last, after the release PR is merged.
3. **GitHub environment `npm`** (done: owner is required reviewer, `main` only, per the owner's check) (Settings → Environments): required reviewer = owner; deployment branches = `main` only.
   If it does not exist, GitHub creates it on the first run **without** a required reviewer, so that run would not wait for your approval.
4. **Trusted publisher on npm** (done 11 Nov 2026 by the owner; verified by the 0.1.1 workflow release) for each of the five packages: GitHub Actions, owner `metafrogmeme-droid`,
   repository `paid-lock`, workflow `release.yml`, environment `npm`. A package must exist on npm first, so 0.1.0 goes
   out once by hand: see "First publish (one time)" below. Never add an npm token to the repository or CI.

## First publish (one time)

**Done on 11 Nov 2026** (owner, from `main` at `5a87659`): steps 1 to 7 below; step 8's GitHub release `v0.1.0` is
published; its Marketplace listing is still the owner's step. Kept as the record of how 0.1.0 was published.

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
   On Windows, run every step from Git Bash, in a checkout made with `core.autocrlf=false` (for example
   `git -c core.autocrlf=false clone …`, or `git config core.autocrlf false` before checking out): the script and
   the format check expect LF line endings. The script's tests spawn bash and are slower there; each has a 60 s
   timeout. The smoke test stops the mock seller by closing its stdin (a SIGTERM on Windows runs no
   handler), and the demo passes `SystemRoot` to the CLI (Windows networking needs it). If npm cannot ask for your
   one-time code in Git Bash's own window, run Git Bash inside Windows Terminal instead.
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
- A partial publish (some packages already out at this version): fix the cause, then run the same version again.
  Already-published packages are skipped (`already published, skipping`); only a clean E404 / "not found" from
  `npm view <name>@<version> version` is treated as unpublished, and any other registry error fails the step. Do
  not bump the version to recover.
