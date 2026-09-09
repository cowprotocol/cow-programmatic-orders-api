import { defineConfig } from "vitest/config";

// Schema tests use real Ponder and PostgreSQL, not the handler test stubs.
export default defineConfig({
  test: { include: ["tests/schema/**/*.test.ts"] },
});
