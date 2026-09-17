---
name: benchmark
description: Use this skill to measure performance baselines, detect regressions before/after PRs, and compare stack alternatives.
---

# Benchmark — Performance Baseline & Regression Detection

## When to Use

- Before and after a PR to measure performance impact
- Setting up performance baselines for a project
- When users report "it feels slow"
- Before a launch — ensure you meet performance targets
- Comparing your stack against alternatives

## How It Works

### Mode 1: Page Performance

Measures real browser metrics via a browser automation/devtools MCP (or an equivalent local tool):

```
1. Navigate to each target URL
2. Measure Core Web Vitals:
   - LCP (Largest Contentful Paint) — target < 2.5s
   - CLS (Cumulative Layout Shift) — target < 0.1
   - INP (Interaction to Next Paint) — target < 200ms
   - FCP (First Contentful Paint) — target < 1.8s
   - TTFB (Time to First Byte) — target < 800ms
3. Measure resource sizes:
   - Total page weight (target < 1MB)
   - JS bundle size (target < 200KB gzipped)
   - CSS size
   - Image weight
   - Third-party script weight
4. Count network requests
5. Check for render-blocking resources
```

### Mode 2: API Performance

Benchmarks API endpoints:

```
1. Hit each endpoint 100 times
2. Measure: p50, p95, p99 latency
3. Track: response size, status codes
4. Test under load: 10 concurrent requests
5. Compare against SLA targets
```

### Mode 3: Build Performance

Measures development feedback loop:

```
1. Cold build time
2. Hot reload time (HMR)
3. Test suite duration
4. TypeScript check time
5. Lint time
6. Docker build time
```

### Mode 4: Before/After Comparison

Run before and after a change to measure impact. This skill does not ship a dedicated slash command — run the two passes manually (or wrap them in your own project script/command) and diff the saved JSON:

```
1. Run the relevant mode(s) above, save the result as baseline.json
2. ... make changes ...
3. Re-run the same mode(s), save as current.json
4. Diff baseline.json vs current.json metric by metric
```

Output:
```
| Metric | Before | After | Delta | Verdict |
|--------|--------|-------|-------|---------|
| LCP | 1.2s | 1.4s | +200ms | WARNING: WARN |
| Bundle | 180KB | 175KB | -5KB | ✓ BETTER |
| Build | 12s | 14s | +2s | WARNING: WARN |
```

## Output

Store baselines under `.jarvis-cc/benchmarks/` (or a project-appropriate equivalent) as JSON, git-tracked so the team shares baselines.

## Integration

- CI: run the before/after comparison workflow above on every PR
- Pair with whatever post-deploy monitoring you have configured, so a benchmark regression that slips through review still gets caught live
- Pair with a pre-ship QA pass (manual or automated) for a full pre-ship checklist alongside the performance numbers
