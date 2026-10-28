import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    include: ["src/tests/**/*.test.tsx"],
    // findBy* waits up to 5 s (setup.ts, DECISIONS B34). With 13 files running in parallel,
    // a test that walks through a few pages (sign up, import, reload) can take longer than
    // Vitest's 5 s default in total, so each test gets 15 s (DECISIONS B42).
    testTimeout: 15_000,
  },
});
