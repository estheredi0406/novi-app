import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Tests read .env.test, not .env, so they never touch the development database.
const testEnv = config({ path: ".env.test" }).parsed ?? {};

export default defineConfig({
  test: {
    env: testEnv,
    globalSetup: ["./src/test/globalSetup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // Test files share one database, so they run one after another.
    fileParallelism: false,
  },
});