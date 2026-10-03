import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
    // Live suites (INTEGRATION=1) hit public endpoints that occasionally
    // return 503s; retry those. Unit tests stay strict.
    retry: process.env.INTEGRATION === "1" ? 2 : 0,
    // versions and health judge against the bundled matrix unless a test opts in to Midnight's published one.
    env: { MN_OFFLINE: "1" },
  },
});
