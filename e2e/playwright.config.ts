import { defineConfig, devices } from "@playwright/test";

// The smoke tests (M11; DECISIONS B39) run the real API and the production web build
// against a database loaded with the small test catalogue, and a fake Anthropic.
//
// Locally, with `docker compose up` running (it provides Postgres on 5432):
//   1. once: create the database and load the catalogue (README, "Tests");
//   2. cd e2e && npm ci && npx playwright install chromium && npm test
// CI does the same against a throwaway Postgres service (.github/workflows/ci.yml).
//
// Every process gets its own port, so the tests never touch the dev stack (3000, 5173)
// and a dev API holding a real key is never in the path.
const databaseUrl = process.env.E2E_DATABASE_URL ?? "postgres://scense:scense_dev@localhost:5432/scense_test";
const MOCK_PORT = 4010;
const API_PORT = 3100;
const WEB_PORT = 4173;

export default defineConfig({
  testDir: "tests",
  // One worker: the tests share one database and one API process, and four tests run
  // in well under a minute anyway.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node mock-anthropic.mjs",
      url: `http://localhost:${MOCK_PORT}/_calls`,
      env: { MOCK_ANTHROPIC_PORT: String(MOCK_PORT) },
      reuseExistingServer: false,
    },
    {
      command: "npm start",
      cwd: "../api",
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: databaseUrl,
        PORT: String(API_PORT),
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
        // Test-only values. The key is not a real key: if the base URL below were ever
        // ignored, Anthropic would refuse it (401) rather than bill anyone.
        JWT_SECRET: "e2e-only-secret-at-least-32-characters-long",
        COOKIE_SECURE: "false",
        BCRYPT_COST: "4",
        ANTHROPIC_API_KEY: "e2e-fake-key-not-a-real-key",
        ANTHROPIC_BASE_URL: `http://localhost:${MOCK_PORT}`,
      },
    },
    {
      // The production build, served by Vite's preview server, which proxies /api the
      // same way the dev server does (vite.config.ts).
      command: `npm run build && npx vite preview --port ${WEB_PORT} --strictPort`,
      cwd: "../web",
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
    },
  ],
});
