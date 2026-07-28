# Release Process

Releases are cut from `main` in **two steps**. `main` is protected by a
`pull_request` ruleset, so the version bump cannot be pushed directly — it has
to go through a PR. Only then is the merged commit tagged.

## Step 1: open the version bump PR

From an up-to-date `main` with a clean working tree:

```bash
git checkout main && git pull
./scripts/release.sh
```

Follow the prompts to select the version type:

- patch: for bug fixes (0.0.X)
- minor: for new features (0.X.0)
- major: for breaking changes (X.0.0)

This bumps the version in `package.json`, pushes a `release/vX.Y.Z` branch, and
opens a PR. It does **not** create a tag.

## Step 2: tag the merged commit

Once that PR is merged:

```bash
git checkout main && git pull
./scripts/release.sh --tag
```

This tags the merged commit on `main` and pushes the tag, which triggers the
Release workflow.

The script refuses to run from any branch other than `main`. Tagging from a
feature branch produces a tag that is not an ancestor of `main` — that is how
`v0.3.40` ended up orphaned.

The GitHub Actions workflow will automatically:

1. Run lint checks
2. Run unit tests
3. Run integration tests
4. **Stage** the package on NPM (not yet public — see below)
5. Create a GitHub release with generated release notes

You can monitor the release progress at:
https://github.com/grafana/backstage-plugin-grafana-catalog/actions

## Step 4: Approve the staged package

**The release is not complete when the workflow goes green.** CI does not have
permission to publish publicly — it can only stage.

We authenticate to NPM with [trusted publishing][tp]: GitHub Actions mints a
short-lived OIDC token instead of using a stored NPM token. The trusted
publisher is deliberately configured **stage-only**, so a compromised CI run
cannot ship a public release by itself. A maintainer must approve each version
with a 2FA challenge.

After the workflow succeeds:

```bash
npm stage list @grafana/catalog-backend-module-grafana-servicemodel
npm stage view <stage-id>       # optional: inspect the tarball first
npm stage approve <stage-id>    # prompts for 2FA
```

Or use the **Staged Packages** tab on npmjs.com.

Requires npm >= 11.15.0 and 2FA enabled on your npm account.

## Troubleshooting

**Publish job fails with a 404 or `ENEEDAUTH`.** These errors are misleading;
they usually mean the OIDC exchange never happened. Check that nobody re-added
`registry-url` to `actions/setup-node` in the publish job — it writes an empty
`_authToken` into `.npmrc`, which makes npm think auth is already configured and
skip OIDC entirely. This silently broke every release from v0.3.29 to v0.3.39.
The `Verify trusted publishing preconditions` step now catches this.

**Publish job fails claiming the action is not permitted.** The trusted
publisher's allowed actions on npmjs.com must match the command the workflow
runs. It currently allows `npm stage publish` only.

**`E422 ... Error verifying sigstore provenance bundle`.** npm cross-checks
`repository.url` in `package.json` against the repository recorded in the
provenance attestation, and rejects the upload if they disagree. Keep
`repository.url` pointed at `github.com/grafana/backstage-plugin-grafana-catalog`
in a form `hosted-git-info` can parse — a bare `github.com/...` string with no
scheme normalizes to `null` and will fail this check.

Note: You'll need appropriate permissions to push to the repository, and to be a
maintainer on the NPM package to approve staged releases.

[tp]: https://docs.npmjs.com/trusted-publishers/
