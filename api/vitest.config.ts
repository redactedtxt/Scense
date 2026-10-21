import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    // Belt and braces for SPEC section 14: even if a developer's shell exports a real
    // key, nothing under test can build a client with it. Tests use a fake model.
    env: { ANTHROPIC_API_KEY: "" },
  },
});
