// Copies the Ewe sentences from docs/ewe/key-sentences.csv into
// src/i18n/ee.json. Run from apps/mobile after filling the "eʋegbe" column:
//
//   node scripts/importEwe.mjs
//
// Only the "eʋegbe" column is copied: the sentences a speaker wrote or
// checked. "brouillon_claude" is a draft to correct, never shipped as is.
// To try the drafts on your own phone only, add --brouillon: an empty
// "eʋegbe" cell then takes the draft. Do not publish an update made that way.
//
// Only filled cells are copied; an empty cell keeps falling back to French.
// Words in {{double braces}} are filled in by the app (a name, an amount)
// and must stay exactly as they are; the script refuses a sentence that
// lost or changed one.
import { readFileSync, writeFileSync } from "node:fs";

const csvPath = new URL("../../../docs/ewe/key-sentences.csv", import.meta.url);
const eePath = new URL("../src/i18n/ee.json", import.meta.url);

// A small CSV reader: commas, quotes and doubled quotes, as Excel writes them.
function parse(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === ";") (row.push(cell), (cell = ""));
    else if (c === "\n") (row.push(cell.replace(/\r$/, "")), rows.push(row), (row = []), (cell = ""));
    else cell += c;
  }
  if (cell || row.length) (row.push(cell), rows.push(row));
  return rows;
}

const placeholders = (s) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(",");
const [header, ...rows] = parse(readFileSync(csvPath, "utf8").replace(/^\uFEFF/, ""));
const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name);
const KEY = col("key");
const FR = col("francais");
const EWE = col("eʋegbe");
const DRAFT = col("brouillon_claude");
const useDrafts = process.argv.includes("--brouillon");
if (KEY < 0 || FR < 0 || EWE < 0) throw new Error("The sheet needs the columns key, francais and eʋegbe.");
const ee = JSON.parse(readFileSync(eePath, "utf8"));
let copied = 0;
const problems = [];

for (const row of rows) {
  const key = row[KEY];
  const fr = row[FR] ?? "";
  const ewe = row[EWE]?.trim() || (useDrafts && DRAFT >= 0 ? row[DRAFT]?.trim() : "");
  if (!key || !ewe) continue;
  if (placeholders(fr) !== placeholders(ewe)) {
    problems.push(`${key}: keep ${placeholders(fr) || "no {{…}}"} exactly`);
    continue;
  }
  const parts = key.split(".");
  let node = ee;
  for (const part of parts.slice(0, -1)) node = node[part] ??= {};
  node[parts.at(-1)] = ewe;
  copied++;
}

writeFileSync(eePath, `${JSON.stringify(ee, null, 2)}\n`);
console.log(`${copied} Ewe sentences copied into src/i18n/ee.json.`);
if (problems.length) {
  console.log(`Not copied, check the {{…}} words:\n${problems.join("\n")}`);
  process.exitCode = 1;
}
