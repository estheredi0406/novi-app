import autocannon from "autocannon";
import fs from "node:fs";
const { groupId, token } = JSON.parse(fs.readFileSync("seed.json", "utf8"));
const H = { authorization: `Bearer ${token}` };
const targets = [
  ["GET /health (API + database ping)", "/health", {}],
  ["GET /v1/groups (home: her groups, ring, receiver)", "/v1/groups", H],
  ["GET /v1/me/news (home: latest news)", "/v1/me/news?limit=3", H],
  ["GET /v1/groups/:id/rounds/1 (round with 12 payments)", `/v1/groups/${groupId}/rounds/1`, H],
];
const rows = [];
for (const c of [50, 100]) {
  for (const [label, path, headers] of targets) {
    const r = await autocannon({ url: (process.env.API ?? "http://localhost:3100") + path, connections: c, duration: 15, headers });
    rows.push({ label, connections: c, reqPerSec: Math.round(r.requests.average), p50: r.latency.p50, p97_5: r.latency.p97_5, p99: r.latency.p99, max: r.latency.max, errors: r.errors + r.timeouts, non2xx: r.non2xx, total: r.requests.total });
    console.log(JSON.stringify(rows.at(-1)));
  }
}
fs.writeFileSync("results.json", JSON.stringify(rows, null, 2));
