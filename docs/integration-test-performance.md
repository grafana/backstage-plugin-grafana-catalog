# Integration Test Performance Optimization

## Current Implementation: BuildKit Cache Mounts ✅

We've implemented Docker BuildKit cache mounts to speed up the integration test builds:

### What was changed:
1. **CI Workflow** (`.github/workflows/ci.yaml`):
   - Added `docker/setup-buildx-action@v3` to enable BuildKit
   - Set `DOCKER_BUILDKIT: "1"` environment variable

2. **Dockerfile** (`tests/integration/Dockerfile`):
   - Added `--mount=type=cache` directives for:
     - `/root/.yarn` (yarn package cache)
     - `/root/.cache/node-gyp` (native module build cache)

### Expected Performance Impact:
- **First build:** ~5-10 minutes (no cache)
- **Subsequent builds:** ~1-3 minutes (with cache)
- **Cache hit ratio:** 80-90% for unchanged dependencies

### How it works:
BuildKit cache mounts persist directories between Docker builds:
- Yarn cache: Avoids re-downloading npm packages
- node-gyp cache: Avoids recompiling native modules (isolated-vm, better-sqlite3, etc.)

---

## Additional Options (Not Implemented)

### Option 2: Pre-built Base Image

Create a base Docker image with Backstage pre-installed and publish to a registry.

**Pros:**
- Fastest builds (1-2 minutes)
- No dependency downloads during CI
- Can version the base image

**Cons:**
- Requires maintaining a separate base image
- Need container registry (GHCR, Docker Hub)
- Adds complexity to version management
- Need to rebuild base image when Backstage updates

**Implementation:**
```dockerfile
# Base image (built separately and pushed to registry)
FROM node:22 as backstage-base
WORKDIR /app
RUN npx @backstage/create-app@latest --skip-install && \
    cd backstage && \
    yarn install --inline-builds

# Integration test image (fast builds)
FROM ghcr.io/grafana/backstage-base:latest
COPY src /app/plugin/src
# ... rest of setup
```

**When to use:** If you run integration tests very frequently (>10x per day).

---

### Option 3: GitHub Actions Cache with docker/build-push-action

Use GitHub Actions cache for Docker layers.

**Pros:**
- Native GitHub Actions integration
- Automatic cache management
- Works across branches

**Cons:**
- 10GB cache limit per repository
- Slightly slower than BuildKit cache mounts
- More complex workflow configuration

**Implementation:**
```yaml
- name: Build Docker image
  uses: docker/build-push-action@v5
  with:
    context: .
    file: tests/integration/Dockerfile
    cache-from: type=gha
    cache-to: type=gha,mode=max
    load: true
    tags: backstage:test
```

**When to use:** If BuildKit cache mounts don't provide enough speedup.

---

### Option 4: Reduce Backstage Installation Scope

Only install backend packages, skip frontend to reduce installation time.

**Pros:**
- 30-40% faster installation
- Smaller Docker image
- Less disk space usage

**Cons:**
- Requires custom Backstage setup script
- May not work with future Backstage versions
- More maintenance overhead

**Implementation:**
Modify `@backstage/create-app` template to only include backend packages, or manually craft a minimal package.json.

**When to use:** If you never use frontend components in integration tests.

---

### Option 5: Local Registry Cache

Use a local npm registry proxy (Verdaccio) to cache packages.

**Pros:**
- Works for all Docker builds
- Can share cache across multiple projects
- Reduces npm registry load

**Cons:**
- Complex setup in GitHub Actions
- Requires running a registry service
- Additional infrastructure to maintain

**When to use:** If you have many projects doing similar npm installs.

---

## Performance Monitoring

To measure the impact of optimizations, check the "Run integration tests" step duration in GitHub Actions:

**Before optimization:** ~8-12 minutes
**After BuildKit cache (first run):** ~8-12 minutes (cache miss)
**After BuildKit cache (subsequent):** ~2-4 minutes (cache hit)

### Monitoring cache effectiveness:

Check Docker build output for cache hits:
```
#8 [2/5] RUN --mount=type=cache,target=/root/.yarn ...
#8 CACHED
```

---

## Recommendations

1. **Start with BuildKit cache mounts** (✅ implemented)
   - Low effort, high impact
   - No additional infrastructure needed

2. **Monitor performance for 1 week**
   - Track build times in GitHub Actions
   - Verify cache hit rates

3. **Consider pre-built base image if:**
   - Build times still >5 minutes with cache
   - Integration tests run >10x per day
   - Backstage version updates are infrequent

4. **Don't over-optimize prematurely**
   - Current solution should provide 60-70% speedup
   - Additional complexity may not be worth marginal gains

---

## Troubleshooting

### Cache not being used

If builds are still slow:
1. Check that BuildKit is enabled: `DOCKER_BUILDKIT=1`
2. Verify cache mount syntax is correct
3. Check GitHub Actions has enough disk space
4. Look for cache invalidation (dependency changes)

### Cache size growing too large

BuildKit automatically manages cache size, but you can manually prune:
```bash
docker buildx prune --filter type=exec.cachemount
```

### Different cache per branch

This is expected behavior - cache is isolated per branch for safety. Consider using GitHub Actions cache if you need cross-branch caching.
