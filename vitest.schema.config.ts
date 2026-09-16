import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Schema tests use real Ponder and PostgreSQL, not the handler test stubs.
export default defineConfig({
  test: { include: ["tests/schema/**/*.test.ts"] },
  resolve: { alias: {
    "ponder:schema": fileURLToPath(new URL("./ponder.schema.ts", import.meta.url)),
    "ponder:registry": fileURLToPath(new URL("./tests/__mocks__/ponder-registry.ts", import.meta.url)),
  } },
});
