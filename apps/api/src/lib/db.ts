import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

// The database address comes from the environment: the .env file on a
// developer's machine, or the hosting platform's settings in production.
const connectionString = process.env.DATABASE_URL;

// Stop at startup with a clear message rather than failing later
// with a confusing error on the first request.
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

// One client for the whole API: it holds a pool of connections
// that every route reuses.
const adapter = new PrismaPg({ connectionString });
export const prisma = new PrismaClient({ adapter });