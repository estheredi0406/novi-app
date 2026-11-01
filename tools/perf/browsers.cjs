(async()=>{
const { chromium, devices } = require("playwright");
const fs = require("node:fs");
const token = process.env.STAFF_TOKEN; // copy it from sessionStorage "novi-console-token" after logging in
if (!token) throw new Error("Set STAFF_TOKEN");
const { groupId } = JSON.parse(fs.readFileSync("seed.json", "utf8"));
const sizes = [
  ["Desktop 1440×900", { viewport: { width: 1440, height: 900 } }],
  ["Laptop 1280×720", { viewport: { width: 1280, height: 720 } }],
  ["Small laptop 1024×768", { viewport: { width: 1024, height: 768 } }],
  ["Tablet 768×1024", { viewport: { width: 768, height: 1024 } }],
  ["Phone (Pixel 5 emulation)", devices["Pixel 5"]],
];
const pages = [["Overview", "#/"], ["Group", `#/groups/${groupId}`], ["Loans", "#/loans"], ["Journal", "#/activity"], ["Analytics", "#/analytics"], ["Members", "#/members"]];
fs.mkdirSync("shots", { recursive: true });
const b = await chromium.launch();
const rows = [];
for (const [label, opts] of sizes) {
  const ctx = await b.newContext({ ...opts, locale: "fr-FR" });
  await ctx.addInitScript((t) => { try { sessionStorage.setItem("novi-console-token", t); } catch {} }, token);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && !/TUNNEL/.test(m.text()) && errors.push(m.text()));
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  for (const [name, hash] of pages) {
    await p.goto("about:blank");
    const t0 = Date.now();
    await p.goto((process.env.API ?? "http://localhost:3100") + "/console/" + hash, { waitUntil: "networkidle" });
    const ms = Date.now() - t0;
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await p.waitForTimeout(300);
    const h1 = await p.evaluate(() => document.querySelector("main h1, h1, h2")?.textContent ?? "");
    const wide = await p.evaluate(() => [...document.querySelectorAll("main *")].filter(e=>e.getBoundingClientRect().right>window.innerWidth+2 && getComputedStyle(e).position!=="fixed").length);
    await p.screenshot({ path: `shots/${label.split(" ")[0]}-${name}.png`, fullPage: false });
    rows.push({ size: label, page: name, loadMs: ms, horizontalScroll: overflow, heading: h1.slice(0, 30), clipped: wide });
  }
  rows.push({ size: label, page: "errors", errors: errors.length, sample: errors[0]?.slice(0, 120) ?? "" });
  await ctx.close();
}
await b.close();
console.table(rows);
fs.writeFileSync("browsers.json", JSON.stringify({ chromium: b.version?.() ?? "", rows }, null, 2));
})();
