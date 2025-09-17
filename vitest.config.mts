// vitest.config.mts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    setupFiles: ["./tests/setup.ts"],
    sequence: { concurrent: false },       // no concurrent tests within a file
    pool: "threads",                       // default, but explicit is nice
    poolOptions: {
      threads: { singleThread: true },     // ✅ run all tests in a single worker
    },
  },
  resolve: {
    alias: { "@": resolve(__dirname, "./src") },
  },
});
