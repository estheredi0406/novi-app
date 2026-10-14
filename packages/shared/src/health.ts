// The body of GET /health, read by the app and by monitoring tools.
export type HealthResponse = {
  status: "ok" | "degraded";
  database: "ok" | "unreachable";
};