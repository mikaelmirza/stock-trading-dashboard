import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    setupFiles: ["./vitest.setup.ts"],
    // Several test files share the local dev Postgres DB and create/delete
    // User rows; running files in parallel risks one file's cleanup deleting
    // another's in-progress fixtures. Revisit once Phase J (PLAN step 39)
    // adds a dedicated disposable test database.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
