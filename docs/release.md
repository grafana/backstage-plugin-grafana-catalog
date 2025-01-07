# Release Process

The release process is automated using GitHub Actions. To create a new release:

1. Ensure you're on the branch you want to release from and all changes are committed.

2. Run the release script:

   ```bash
   ./scripts/release.sh
   ```

3. Follow the prompts to select the version type:
   - patch: for bug fixes (0.0.X)
   - minor: for new features (0.X.0)
   - major: for breaking changes (X.0.0)

The script will:

- Verify your working directory is clean
- Ensure you're up to date with the remote
- Update the version in package.json
- Create and push a git tag
- Push the changes

The GitHub Actions workflow will automatically:

1. Run lint checks
2. Run unit tests
3. Run integration tests
4. Publish to NPM
5. Create a GitHub release with generated release notes

You can monitor the release progress at:
https://github.com/grafana/backstage-plugin-grafana-catalog/actions

Note: You'll need appropriate permissions to push to the repository and publish to NPM.
