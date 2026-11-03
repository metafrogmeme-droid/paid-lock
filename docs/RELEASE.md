# Release

Nothing is published until the owner says go in his own words (CLAUDE.md §5 rule 9). Claude prepares the
workflow, this runbook and the release PR; it never publishes, tags, makes the repository public or changes
repository settings. Status: **nothing published; the repository is private; every package is `"private": true`.**

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
   `CHANGELOG.md` has a `## X.Y.Z` section. Today it refuses: every package is private.
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
   repository `paid-lock`, workflow `release.yml`, environment `npm`. If npm requires a package to exist before a
   trusted publisher can be added, the first publish needs a different route; that is a separate owner decision
   (check npm's documentation at the time; do not add a long-lived token to the repository).

## Release steps

1. **Release PR** (Claude prepares, owner merges): versions `0.0.0 → X.Y.Z` in the five `package.json` files and in
   `packages/cli/src/main.ts` (`VERSION`), `"private": false` on those five, and a `## X.Y.Z` section in
   `CHANGELOG.md` (rename `## X.Y.Z (unreleased)` to `## X.Y.Z`). CI must be green; `node scripts/release-check.ts X.Y.Z "publish X.Y.Z"` must print OK.
2. **Publish** (owner): Actions → release → Run workflow on `main`, enter `X.Y.Z` and `publish X.Y.Z`, approve the
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
