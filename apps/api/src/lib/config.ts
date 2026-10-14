import "dotenv/config";

// Reads a required setting from the environment and stops the API at startup
// if it is missing, so a misconfigured server never runs half-working.
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

// Every secret setting the API needs, read once at startup.
export const config = {
  jwtSecret: required("JWT_SECRET"),
  niuHashKey: required("NIU_HASH_KEY"),
};