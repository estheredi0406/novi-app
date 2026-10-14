import { execSync } from "node:child_process";
import { config } from "dotenv";

// Runs once before all tests: brings the test database up to the latest
// migrations, so tests always run against the current table structure.
export default function setup(): void {
  const env = config({ path: ".env.test" }).parsed;
  if (!env?.DATABASE_URL?.includes("/novi_test")) {
    throw new Error("DATABASE_URL in .env.test must point to novi_test.");
  }
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, ...env } });
}