import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", ".claude/**"],
    // Many suites `await import()` route handlers or server modules inside a
    // test body; the first import transforms a large module graph (workflows,
    // agents, Inngest) and can take several seconds on a loaded machine or a
    // 2-core CI runner. The 5 s default flakes there, so allow headroom.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
