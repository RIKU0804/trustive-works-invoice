import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Playwright config for invoice-saas2 E2E tests.
 *
 * - chromium のみ
 * - parallel = 1（実DBに対する読み書きを直列化して flaky を抑制）
 * - retries = 1
 * - 既存の dev server に接続する想定。webServer は使用しない
 *   （Supabase / Python API / Next.js は手動起動済みであることが前提）
 */
export default defineConfig({
  testDir: "./tests/e2e/specs",
  outputDir: "./tests/e2e/.artifacts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  globalSetup: "./tests/e2e/setup/global-setup.ts",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "./tests/e2e/.auth/user.json",
      },
    },
  ],
});
