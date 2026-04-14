import { defineConfig, devices } from "@playwright/test";

/**
 * E2E: Vite dev server + mocked API on port 8000 (see e2e/api-mock.ts).
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      VITE_API_BASE_URL: "http://127.0.0.1:8000/api",
    },
    timeout: 120_000,
  },
});
