# Release

Nothing is published until the owner says go in his own words (CLAUDE.md §5 rule 9). Claude prepares the
workflow, this runbook and the release PR; it never publishes, tags, makes the repository public or changes
repository settings.

## Status (11 Nov 2026)

**0.1.0 is published**, by the owner's one-time first publish from his own computer (see "First publish (one time)").

| Item                                                                                                                     | State                                                                                                                                                                                                                                                                           | How it was checked                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| npm `paid-lock`, `@paid-lock/core`, `@paid-lock/protocols`, `@paid-lock/probe`, `@paid-lock/runtime`                     | `latest` = `0.1.0`, MIT, published 11 Nov 2026 between 11:20 and 11:22 UTC (`@paid-lock/core` last, at 11:22) by the owner from `main` at `5a87659` (owner's report; npm records no commit for these tarballs); dependencies on each other pinned to `0.1.0` (no `workspace:*`) | `npm view` (public registry)                                                                                |
| Placeholder version `0.0.0-stage` on each of the five                                                                    | also listed (published 11:18 to 11:19 UTC, before 0.1.0); not `latest`                                                                                                                                                                                                          | `npm view <name> versions`                                                                                  |
| Provenance for 0.1.0                                                                                                     | none, as expected for a publish from a laptop                                                                                                                                                                                                                                   | `npm view <name>@0.1.0 dist.attestations` is empty                                                          |
| GitHub release `v0.1.0`                                                                                                  | published, marked Latest, tag `v0.1.0` = `5a87659`                                                                                                                                                                                                                              | GitHub API, `git ls-remote --tags`                                                                          |
| Trusted publisher on each of the five (GitHub Actions, `metafrogmeme-droid/paid-lock`, `release.yml`, environment `npm`) | added by the owner (owner's report)                                                                                                                                                                                                                                             | **not independently checked**: npm shows a package's trusted publishers only to its maintainers, behind 2FA |
| GitHub environment `npm` with the owner as required reviewer                                                             | not reported yet                                                                                                                                                                                                                                                                | needs repository settings access; check before 0.1.1 (One-time setup, step 3)                               |
| Repository visibility                                                                                                    | private: an unauthenticated request to the repository page returns 404                                                                                                                                                                                                          | `curl` without credentials, 11 Nov 2026                                                                     |
| Marketplace listing of the Action                                                                                        | not yet (needs a public repository)                                                                                                                                                                                                                                             | follows from the row above                                                                                  |

**The first release through the workflow (0.1.1 or later) is what verifies the trusted publishers.** If one of them is
wrong (owner, repository, workflow file name or environment), the `Publish` step fails for that package with an
authentication error and nothing more is published; fix the trusted publisher on npmjs.com and run the workflow again
(see "If something goes wrong"). The workflow publishes with `--provenance`, and npm only issues provenance for a public
source repository, so **make the repository public before that release** (One-time setup, step 2). A successful run
also shows provenance on npm for that version (`npm audit signatures` in a project that installs it).

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

1. **npm names** (done 11 Nov 2026: the five names are published). Create the npm organisation `paid-lock` (owns the `@paid-lock` scope) and check that the unscoped
   name `paid-lock` is still free (both were on 31 Oct 2026; OPEN_QUESTIONS #1).
2. **Make the repository public** (open: still private on 11 Nov 2026; needed before the 0.1.1 release). The Marketplace requires it, and npm provenance is only issued for public
   repositories. Do this last, after the release PR is merged.
3. **GitHub environment `npm`** (not reported yet; check before 0.1.1) (Settings → Environments): required reviewer = owner; deployment branches = `main` only.
   If it does not exist, GitHub creates it on the first run **without** a required reviewer, so that run would not wait for your approval.
4. **Trusted publisher on npm** (done 11 Nov 2026 by the owner; verified by the first workflow release) for each of the five packages: GitHub Actions, owner `metafrogmeme-droid`,
   repository `paid-lock`, workflow `release.yml`, environment `npm`. A package must exist on npm first, so 0.1.0 goes
   out once by hand: see "First publish (one time)" below. Never add an npm token to the repository or CI.

## First publish (one time)

**Done on 11 Nov 2026** (owner, from `main` at `5a87659`): steps 1 to 7 below; step 8's GitHub release `v0.1.0` is
published, its Marketplace listing waits for the repository to be public. Kept as the record of how 0.1.0 was published.

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
- A partial publish (some packages out): rerun with the same version fails for the ones already out; publish the
  rest by running the workflow again after a release PR that bumps only what is missing, or deprecate and bump all.
