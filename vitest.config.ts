import { defineConfig } from "vitest/config";

// Deliberately separate from vite.config.ts: the React Router plugin owns the
// build pipeline and does not need to run for unit tests.
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["app/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
  },
  resolve: {
    tsconfigPaths: true,
  },
});
