import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
    // Live suites (INTEGRATION=1) hit public endpoints that occasionally
    // return 503s; retry those. Unit tests stay strict.
    retry: process.env.INTEGRATION === "1" ? 2 : 0,
  },
});
