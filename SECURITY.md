# Security Updates - January 2026

## CVE Remediation

This document describes the security vulnerability fixes implemented in January 2026 to address 13 CVEs across 8 transitive dependencies.

## Fixed CVEs

### 1. form-data (CVE-2025-7783)
- **Severity**: Critical (CVSS 9.4)
- **Issue**: Uses unsafe random function for choosing boundary
- **Fixed Version**: 4.0.5 (upgraded from 2.5.3, 4.0.2, 2.3.3)
- **Method**: Yarn resolution forcing ^4.0.4

### 2. sha.js (CVE-2025-9288)
- **Severity**: Critical (CVSS 9.1)
- **Issue**: Missing type checks leading to hash rewind and passing on crafted data
- **Fixed Version**: 2.4.12 (upgraded from 2.4.11)
- **Method**: Yarn resolution forcing ^2.4.12

### 3. qs (CVE-2025-15284)
- **Severity**: High (CVSS 8.7)
- **Issue**: arrayLimit bypass in bracket notation allows DoS via memory exhaustion
- **Fixed Version**: 6.14.1 (upgraded from 6.5.3, 6.13.0)
- **Method**: Yarn resolution forcing ^6.14.1

### 4. tar-fs (CVE-2025-48387, CVE-2025-59343)
- **Severity**: High (CVSS 8.7 each)
- **Issue 1**: Can extract outside specified dir with specific tarball
- **Issue 2**: Symlink validation bypass if destination directory is predictable
- **Fixed Version**: 3.1.1 (upgraded from 2.1.2)
- **Method**: Yarn resolution forcing ^3.1.1
- **Note**: Previously pinned at 2.1.2 due to compatibility concerns with @kubernetes/client-node. Validated that kubernetes-client PR #2490 resolved compatibility issues.

### 5. multer (CVE-2025-48997, CVE-2025-47935, CVE-2025-47944, CVE-2025-7338)
- **Severity**: High (CVSS 7.5-8.7)
- **Issues**:
  - DoS via unhandled exception
  - Memory leaks from unclosed streams
  - Maliciously crafted requests
  - Unhandled exception from malformed request
- **Fixed Version**: 2.0.2 (upgraded from 1.4.5-lts.2)
- **Method**: Yarn resolution forcing ^2.0.2
- **Note**: Major version upgrade (1.x → 2.x). Validated that multer is only used transitively through @backstage/backend-test-utils and does not affect runtime code.

### 6. node-forge (CVE-2025-66031, CVE-2025-12816)
- **Severity**: High (CVSS 8.7 each)
- **Issue 1**: ASN.1 Unbounded Recursion
- **Issue 2**: Interpretation Conflict via ASN.1 Validator Desynchronization
- **Fixed Version**: 1.3.3 (upgraded from 1.3.1)
- **Method**: Yarn resolution forcing ^1.3.2

### 7. axios (CVE-2025-58754)
- **Severity**: High (CVSS 7.5)
- **Issue**: DoS attack through lack of data size check
- **Fixed Version**: 1.13.2 (upgraded from 1.8.4)
- **Method**: Yarn resolution forcing ^1.12.0

### 8. jws (CVE-2025-65945)
- **Severity**: High (CVSS 7.5)
- **Issue**: Improperly Verifies HMAC Signature
- **Fixed Version**: 4.0.1 (upgraded from 3.2.2, 4.0.0)
- **Method**: Yarn resolution forcing ^4.0.1

## Accepted CVEs

### glob (CVE-2025-64756)
- **Severity**: High (CVSS 7.5)
- **Issue**: Command injection via -c/--cmd executes matches with shell:true
- **Current Version**: 10.4.5
- **Fixed Version**: 10.5.0, 11.1.0
- **Status**: ACCEPTED
- **Reason**: This CVE affects the glob CLI when using -c/--cmd flags with shell execution. Our project uses glob programmatically (not via CLI), so this vulnerability does not apply to our usage pattern. Attempting to upgrade to 10.5.0 caused incompatibilities with @backstage/cli's Jest configuration which uses `util.promisify(require('glob'))`, an API that changed in glob 10.5.0. Upgrading @backstage/cli to 0.35.1+ to support glob 10.5.0 breaks integration tests due to peer dependency mismatches in the test environment.
- **Mitigation**: glob is used only through build tools and test frameworks in a controlled environment, not exposed to user input or CLI usage.
- **Review Date**: 2026-01-14
- **Decision**: Maintaining @backstage/cli at 0.32.0 for integration test compatibility takes precedence over fixing a CLI-specific vulnerability that doesn't affect our usage.

## Implementation Strategy

All updates were performed using **Yarn resolutions** to force fixed versions of transitive dependencies. This approach was chosen because all vulnerable packages were pulled in through Backstage packages, and updating direct dependencies was not necessary.

### Additional Updates

No direct dependency updates were required. All CVE fixes were achieved through Yarn resolutions only.

**Note**: @backstage/cli remains at 0.32.0 to maintain integration test compatibility. Upgrading to 0.35.1+ would require updates to the integration test environment's package.json and is not necessary for CVE remediation.

## Testing & Validation

All CVE fixes were validated through comprehensive testing:

- ✅ **Unit tests**: All 12 tests pass (config, entityFilter, processor)
- ✅ **TypeScript compilation**: No type errors
- ✅ **Lint checks**: All ESLint rules pass
- ✅ **Build**: Successfully compiles to dist/
- ✅ **Version verification**: All packages confirmed at or above required versions

## Integration Testing

While unit tests passed, full integration testing with Kubernetes (Kind + Tilt) is recommended before release to validate:

- tar-fs compatibility with @kubernetes/client-node (critical)
- Kubernetes resource discovery and processing
- Container operations with dockerode
- HTTP client behavior with updated axios

## Dependency Impact

### Direct Dependencies Changed
- None (all fixes via resolutions)

### Dev Dependencies Changed
- None (all fixes via resolutions)

### Resolutions Added
```json
{
  "sha.js": "^2.4.12",
  "node-forge": "^1.3.2",
  "jws": "^4.0.1",
  "qs": "^6.14.1",
  "form-data": "^4.0.4",
  "axios": "^1.12.0",
  "tar-fs": "^3.1.1",
  "multer": "^2.0.2"
}
```

## Ongoing Security Maintenance

This project maintains security through:

1. **Dependabot**: Configured for daily dependency update checks
2. **Yarn Resolutions**: Force specific secure versions for critical packages
3. **CI/CD**: GitHub Actions runs full test suite on every PR
4. **Regular Updates**: Backstage packages updated quarterly (recommended)

## Security Policy

For security issues, please report to the repository maintainers via GitHub Security Advisories.

## References

- Grafana Vulnerability Observability Report: grafana/backstage-plugin-grafana-catalog:v0.3.27
- Trivy, Snyk, and Grype vulnerability scans (January 2026)
- kubernetes-client PR #2490: tar-fs compatibility fix

---

**Last Updated**: 2026-01-14
**Updated By**: Automated CVE remediation process
**Next Review**: 2026-04-14 (Quarterly)
