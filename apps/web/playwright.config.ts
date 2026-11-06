import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  // The dev server compiles each page the first time it is opened (charts take a while), so a
  // test that is first to open a page needs more than the default 30 seconds.
  timeout: 60_000,
  // The first request to a page also compiles it in dev, so give assertions headroom.
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    // The live spec (e2e/live.spec.ts) points the web app at a real API: LIVE_API_URL.
    env: { API_URL: process.env.LIVE_API_URL ?? "http://localhost:8000" },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
