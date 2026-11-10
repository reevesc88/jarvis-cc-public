---
name: e2e-testing
description: Playwright E2E testing patterns, Page Object Model, configuration, CI/CD integration, artifact management, and flaky test strategies.
---

# E2E Testing Patterns

Before invoking a CLI, inspect the project manifest and resolve its existing local executable. The `./node_modules/.bin/` examples below are for Bash and fail if the executable is absent; do not fall back to a registry runner. In PowerShell, use the verified `.cmd` shim where applicable. For other package layouts, inspect and use an existing project script or resolved executable. A local executable can itself perform network or write operations; its location grants no authorization for those actions.

Comprehensive Playwright patterns for building stable, fast, and maintainable E2E test suites.

## Installation (Pinned Toolchain)

```bash
# After installation is authorized, select a reviewed version compatible with your project:
npm install --save-dev --save-exact @playwright/test@<reviewed-version>
# Commit the lockfile; replace <reviewed-version> before installing browsers or running tests:
./node_modules/.bin/playwright install --with-deps
```

## Test File Organization

```
tests/
├── e2e/
│   ├── auth/
│   │   ├── login.spec.ts
│   │   ├── logout.spec.ts
│   │   └── register.spec.ts
│   ├── features/
│   │   ├── browse.spec.ts
│   │   ├── search.spec.ts
│   │   └── create.spec.ts
│   └── api/
│       └── endpoints.spec.ts
├── fixtures/
│   ├── auth.ts
│   └── data.ts
└── playwright.config.ts
```

## Page Object Model (POM)

```typescript
import { expect, Page, Locator } from '@playwright/test'

export class ItemsPage {
  readonly page: Page
  readonly searchInput: Locator
  readonly itemCards: Locator
  readonly createButton: Locator
  readonly noResults: Locator

  constructor(page: Page) {
    this.page = page
    this.searchInput = page.locator('[data-testid="search-input"]')
    this.itemCards = page.locator('[data-testid="item-card"]')
    this.createButton = page.locator('[data-testid="create-btn"]')
    this.noResults = page.locator('[data-testid="no-results"]')
  }

  async goto() {
    await this.page.goto('/items')
    await expect(this.searchInput).toBeVisible()
  }

  async search(query: string) {
    const response = this.page.waitForResponse(resp => resp.url().includes('/api/search'))
    await this.searchInput.fill(query)
    await response
    // The response event fires when headers arrive, before the body is
    // consumed and rendered. Wait for a results-ready state (a result card or
    // the empty state) with a retrying assertion before callers read counts.
    await expect(this.itemCards.first().or(this.noResults)).toBeVisible()
  }

  async getItemCount() {
    return await this.itemCards.count()
  }
}
```

## Test Structure

```typescript
import { test, expect } from '@playwright/test'
import { ItemsPage } from '../../pages/ItemsPage'

test.describe('Item Search', () => {
  let itemsPage: ItemsPage

  test.beforeEach(async ({ page }) => {
    itemsPage = new ItemsPage(page)
    await itemsPage.goto()
  })

  test('should search by keyword', async ({ page }) => {
    await itemsPage.search('test')

    // Retrying locator assertions, not a one-shot count() read
    await expect(itemsPage.itemCards).not.toHaveCount(0)
    await expect(itemsPage.itemCards.first()).toContainText(/test/i)
    await page.screenshot({ path: 'artifacts/search-results.png' })
  })

  test('should handle no results', async ({ page }) => {
    await itemsPage.search('xyznonexistent123')

    await expect(itemsPage.noResults).toBeVisible()
    await expect(itemsPage.itemCards).toHaveCount(0)
  })
})
```

## Playwright Configuration

```typescript
import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.BASE_URL || 'http://localhost:3000'
const isLocalTarget = (() => {
  try {
    const { hostname } = new URL(baseURL)
    // WHATWG URL keeps the brackets on IPv6 hostnames: new URL('http://[::1]:3000').hostname === '[::1]'
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
})()

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'playwright-results.xml' }],
    ['json', { outputFile: 'playwright-results.json' }]
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
  ],
  webServer: isLocalTarget
    ? {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      }
    : undefined,
})
```

## Flaky Test Patterns

### Quarantine

```typescript
test('flaky: complex search', async ({ page }) => {
  test.fixme(true, 'Flaky - Issue #123')
  // test code...
})

test('conditional skip', async ({ page }) => {
  test.skip(process.env.CI, 'Flaky in CI - Issue #123')
  // test code...
})
```

### Identify Flakiness

```bash
./node_modules/.bin/playwright test tests/search.spec.ts --repeat-each=10
./node_modules/.bin/playwright test tests/search.spec.ts --retries=3
```

### Common Causes & Fixes

**Race conditions:**
```typescript
// Bad: assumes element is ready
await page.click('[data-testid="button"]')

// Good: auto-wait locator
await page.locator('[data-testid="button"]').click()
```

**Network timing:**
```typescript
// Bad: arbitrary timeout
await page.waitForTimeout(5000)

// Good: wait for specific condition
await page.waitForResponse(resp => resp.url().includes('/api/data'))
```

**Animation timing:**
```typescript
// Bad: global network-idle wait (can time out on polling, SSE, or analytics)
await page.click('[data-testid="menu-item"]')

// Good: assert UI state and rely on locator actionability (which waits for stability)
const menuItem = page.locator('[data-testid="menu-item"]')
await expect(menuItem).toBeVisible()
await menuItem.click()
```

## Artifact Management

### Screenshots

```typescript
await page.screenshot({ path: 'artifacts/after-login.png' })
await page.screenshot({ path: 'artifacts/full-page.png', fullPage: true })
await page.locator('[data-testid="chart"]').screenshot({ path: 'artifacts/chart.png' })
```

### Traces

```typescript
const context = page.context()
await context.tracing.start({
  screenshots: true,
  snapshots: true,
})
// ... test actions ...
await context.tracing.stop({ path: 'artifacts/trace.zip' })
```

### Video

```typescript
// In playwright.config.ts
import { defineConfig } from '@playwright/test'
export default defineConfig({
  outputDir: 'artifacts/test-results',
  use: { video: 'retain-on-failure' },
})
```

## CI/CD Integration

Illustrative cookbook snippet (not an active workflow in this repository). Keep `@playwright/test` pinned with `--save-exact` in `package.json` and locked in `package-lock.json`, and pin every GitHub Action to a reviewed full commit SHA:

```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 20
      - run: npm ci
      - run: ./node_modules/.bin/playwright install --with-deps
      - run: ./node_modules/.bin/playwright test
        env:
          BASE_URL: ${{ vars.STAGING_URL }}
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

## Test Report Template

```markdown
# E2E Test Report

**Date:** YYYY-MM-DD HH:MM
**Duration:** Xm Ys
**Status:** PASSING / FAILING

## Summary
- Total: X | Passed: Y (Z%) | Failed: A | Flaky: B | Skipped: C

## Failed Tests

### test-name
**File:** `tests/e2e/feature.spec.ts:45`
**Error:** Expected element to be visible
**Screenshot:** artifacts/failed.png
**Recommended Fix:** [description]

## Artifacts
- HTML Report: playwright-report/index.html
- Screenshots: artifacts/*.png
- Videos: artifacts/videos/*.webm
- Traces: artifacts/*.zip
```

## Wallet / Web3 Testing

```typescript
test('wallet connection', async ({ page, context }) => {
  // Mock wallet provider
  await context.addInitScript(() => {
    window.ethereum = {
      isMetaMask: true,
      request: async ({ method }) => {
        if (method === 'eth_requestAccounts')
          return ['0x1234567890123456789012345678901234567890']
        if (method === 'eth_chainId') return '0x1'
      }
    }
  })

  await page.goto('/')
  await page.locator('[data-testid="connect-wallet"]').click()
  await expect(page.locator('[data-testid="wallet-address"]')).toContainText('0x1234')
})
```

## Financial / Critical Flow Testing

```typescript
test('trade execution', async ({ page }) => {
  // Set these only after the user authorizes this exact target and trade.
  // Prefer an isolated test account/network with synthetic funds.
  const approvedOrigin = process.env.E2E_APPROVED_TRADE_ORIGIN
  test.skip(process.env.E2E_TRADE_AUTHORIZED !== 'true' || !approvedOrigin, 'Trade not explicitly authorized')

  await page.goto('/markets/test-market')
  // Check the actual destination before any trade interaction (including redirects).
  expect(new URL(page.url()).origin).toBe(approvedOrigin)
  await page.locator('[data-testid="position-yes"]').click()
  await page.locator('[data-testid="trade-amount"]').fill('1.0')

  // Verify preview
  const preview = page.locator('[data-testid="trade-preview"]')
  await expect(preview).toContainText('1.0')

  // Confirm and wait for blockchain
  const response = page.waitForResponse(
    resp => {
      const url = new URL(resp.url())
      return url.origin === approvedOrigin && url.pathname === '/api/trade' &&
        resp.request().method() === 'POST' && resp.status() === 200
    },
    { timeout: 30000 }
  )
  await page.locator('[data-testid="confirm-trade"]').click()
  await response

  await expect(page.locator('[data-testid="trade-success"]')).toBeVisible()
})
```
