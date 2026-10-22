import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    // Belt and braces for SPEC section 14: even if a developer's shell exports a real
    // key, nothing under test can build a client with it. Tests use a fake model.
    env: { ANTHROPIC_API_KEY: "" },
    // With a test database, run test files one at a time. The guest-cap tests in the chat
    // and concierge files both count "distinct guests today" in the same database, so
    // in parallel one file's new guests land between the other's count and its check
    // (M11: seen on every run once CI loaded a database). Without a database every file
    // is a pure unit test and parallel is safe.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
