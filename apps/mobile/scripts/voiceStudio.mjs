// Novi's voice studio (approved designs V1 and V2): a page on your laptop
// where you go through the Ewe key sentences one by one. For each, you can
// correct the Ewe text, listen to the machine voice (made by
// scripts/ewe_voice.py), keep it if it sounds right, or record your own
// voice instead. Only what you keep reaches the app.
//
//   npm run voice:studio          (from apps/mobile)
//   then open http://localhost:5178 in Chrome or Edge
//
// Everything stays in your folder:
//   src/i18n/ee.json and docs/ewe/key-sentences.csv   the Ewe text
//   assets/voice/ee/machine/                           machine clips (not committed)
//   assets/voice/ee/<key>.wav                          the clips you kept
//   docs/ewe/voice-review.json                         what you kept, and for which text
//   src/voice/ee/clips.ts                              what the app plays (written here)
// Then publish to the phones with an update (eas update).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const PORT = 5178;
const useDrafts = process.argv.includes("--brouillon");
const at = (path) => fileURLToPath(new URL(path, import.meta.url));
const EE_JSON = at("../src/i18n/ee.json");
const FR_JSON = at("../src/i18n/fr.json");
const SHEET = at("../../../docs/ewe/key-sentences.csv");
const REVIEW = at("../../../docs/ewe/voice-review.json");
const MACHINE = at("../assets/voice/ee/machine/");
const FINAL = at("../assets/voice/ee/");
const CLIPS_TS = at("../src/voice/ee/clips.ts");
const KEY_RE = /^[a-zA-Z]+(\.[a-zA-Z_]+)+$/;

// ---------- the sheet (same reader as importEwe.mjs) ----------
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
const quote = (v) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const readSheet = () => parse(readFileSync(SHEET, "utf8").replace(/^﻿/, "")).filter((r) => r.some(Boolean));
const writeSheet = (rows) =>
  writeFileSync(SHEET, `﻿${rows.map((r) => r.map((v) => quote(v ?? "")).join(",")).join("\n")}\n`);

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);
const get = (tree, key) => key.split(".").reduce((n, p) => (n && typeof n === "object" ? n[p] : undefined), tree);
function set(tree, key, value) {
  const parts = key.split(".");
  let node = tree;
  for (const part of parts.slice(0, -1)) node = node[part] ??= {};
  node[parts.at(-1)] = value;
}
const placeholders = (s) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(",");

// ---------- the state of each sentence ----------
function sentences() {
  const [header, ...rows] = readSheet();
  const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const ee = readJson(EE_JSON, {});
  const fr = readJson(FR_JSON, {});
  const review = readJson(REVIEW, {});
  const machineTexts = readJson(`${MACHINE}texts.json`, {});
  return rows
    .filter((r) => KEY_RE.test(r[col("key")] ?? ""))
    .map((r) => {
      const key = r[col("key")];
      const checked = get(ee, key) ?? (r[col("eʋegbe")] || "").trim();
      const draft = (r[col("brouillon_claude")] || "").trim();
      const text = checked || (useDrafts ? draft : "");
      const kept = review[key];
      return {
        key,
        fr: get(fr, key) ?? r[col("francais")],
        text,
        checked: Boolean(checked),
        draft,
        dynamic: /\{\{\w+\}\}/.test(get(fr, key) ?? ""),
        machine: Boolean(text) && machineTexts[key] === text && existsSync(`${MACHINE}${key}.wav`),
        kept: kept && existsSync(`${FINAL}${key}.wav`) ? { how: kept.how, current: kept.text === text } : null,
      };
    });
}

// Saves an Ewe sentence where the app and the sheet read it.
function saveText(key, text, fr) {
  if (placeholders(fr) !== placeholders(text)) throw new Error(`Keep ${placeholders(fr) || "no {{…}}"} exactly.`);
  const ee = readJson(EE_JSON, {});
  set(ee, key, text);
  writeFileSync(EE_JSON, `${JSON.stringify(ee, null, 2)}\n`);
  const rows = readSheet();
  const col = rows[0].findIndex((h) => h.trim().toLowerCase() === "eʋegbe");
  const row = rows.find((r) => r[0] === key);
  if (row && col >= 0) {
    row[col] = text;
    writeSheet(rows);
  }
}

// What the app plays: only clips kept for the text the app shows now.
function writeClips() {
  const review = readJson(REVIEW, {});
  const ee = readJson(EE_JSON, {});
  const lines = Object.keys(review)
    .sort()
    .filter((key) => review[key].text === get(ee, key) && existsSync(`${FINAL}${key}.wav`))
    .map(
      (key) =>
        `  ${JSON.stringify(key)}: { text: ${JSON.stringify(review[key].text)}, file: require("../../../assets/voice/ee/${key}.wav") },`,
    );
  mkdirSync(at("../src/voice/ee/"), { recursive: true });
  writeFileSync(
    CLIPS_TS,
    `// Written by scripts/voiceStudio.mjs: the Ewe sentences a person listened to\n` +
      `// and kept, with their sound. Do not edit by hand.\n` +
      `export const clips: Record<string, { text: string; file: number }> = {\n${lines.join("\n")}${lines.length ? "\n" : ""}};\n`,
  );
  return lines.length;
}

function keep(key, how, text) {
  const review = readJson(REVIEW, {});
  review[key] = { how, text, at: new Date().toISOString() };
  writeFileSync(REVIEW, `${JSON.stringify(review, null, 2)}\n`);
  return writeClips();
}

// ---------- the server ----------
const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};
const body = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 5_000_000) reject(new Error("too large"));
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const [, area, what, key] = url.pathname.split("/");
    if (url.pathname === "/") return send(res, 200, PAGE, "text/html; charset=utf-8");
    if (area === "api" && what === "sentences") return send(res, 200, { sentences: sentences(), drafts: useDrafts });
    if (key && !KEY_RE.test(key)) return send(res, 400, { error: "bad key" });
    const one = key ? sentences().find((s) => s.key === key) : undefined;
    if (key && !one) return send(res, 404, { error: "unknown sentence" });

    if (area === "audio" && req.method === "GET") {
      const path = what === "machine" ? `${MACHINE}${key}.wav` : `${FINAL}${key}.wav`;
      if (!existsSync(path)) return send(res, 404, { error: "no clip" });
      return send(res, 200, readFileSync(path), "audio/wav");
    }
    if (area === "api" && req.method === "POST" && one) {
      if (what === "text") {
        const { text } = JSON.parse((await body(req)).toString("utf8"));
        saveText(key, String(text).trim(), one.fr);
        writeClips();
        return send(res, 200, { ok: true });
      }
      if (what === "approve") {
        if (!one.machine) return send(res, 409, { error: "no machine clip for this text: run py scripts/ewe_voice.py" });
        if (!one.checked) saveText(key, one.text, one.fr); // hearing it right confirms the draft
        copyFileSync(`${MACHINE}${key}.wav`, `${FINAL}${key}.wav`);
        return send(res, 200, { clips: keep(key, "machine", one.text) });
      }
      if (what === "record") {
        if (!one.text) return send(res, 409, { error: "write the Ewe sentence first" });
        const wav = await body(req);
        if (wav.subarray(0, 4).toString() !== "RIFF") return send(res, 400, { error: "not a wav" });
        if (!one.checked) saveText(key, one.text, one.fr);
        mkdirSync(FINAL, { recursive: true });
        writeFileSync(`${FINAL}${key}.wav`, wav);
        return send(res, 200, { clips: keep(key, "own", one.text) });
      }
      if (what === "remove") {
        rmSync(`${FINAL}${key}.wav`, { force: true });
        const review = readJson(REVIEW, {});
        delete review[key];
        writeFileSync(REVIEW, `${JSON.stringify(review, null, 2)}\n`);
        return send(res, 200, { clips: writeClips() });
      }
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
}).listen(PORT, "127.0.0.1", () => {
  const clips = writeClips();
  console.log(`Novi voice studio: open http://localhost:${PORT}  (${clips} clips in the app)`);
  if (useDrafts) console.log("Showing Claude's drafts where no checked Ewe sentence exists yet.");
  console.log("Stop with Ctrl+C.");
});

// ---------- the page ----------
const PAGE = /* html */ `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Novi · studio voix</title>
<style>
:root{--navy:#1B1F4B;--orange:#F05A1A;--mist:#DCD8EE;--cotton:#FBF7F2;--line:#E6E1F2;--muted:#3A3D6B;--green:#1E7A4C;--red:#C2362B}
*{box-sizing:border-box}body{margin:0;background:var(--cotton);font-family:"Noto Sans",system-ui,sans-serif;color:#141833}
header{background:#fff;border-bottom:1.5px solid var(--navy);padding:18px 20px 14px;position:sticky;top:0;z-index:2}
.kick{font-weight:700;font-size:13px;color:#C2410C;text-transform:uppercase;letter-spacing:.8px}
h1{margin:4px 0 8px;font-size:28px;color:var(--navy)}
.bar{height:10px;border-radius:5px;background:var(--line);overflow:hidden}.bar div{height:100%;background:var(--green)}
.top{display:flex;justify-content:space-between;font-size:14px;margin-bottom:8px}.top b{font-weight:700}
.chips{display:flex;gap:8px;margin-top:12px}.chip{padding:8px 14px;border-radius:18px;border:1.5px solid var(--line);background:#fff;font-weight:600;cursor:pointer}
.chip.on{background:var(--navy);color:#fff;border-color:var(--navy)}
main{max-width:760px;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:12px}
.card{background:#fff;border:1.5px solid var(--navy);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:10px}
.fr{font-size:13px;color:var(--muted)}.key{font-size:11px;color:#8A88A6;font-family:monospace}
textarea{width:100%;font:inherit;font-size:18px;font-weight:700;border:1.5px solid var(--line);border-radius:12px;padding:10px;resize:vertical;min-height:48px}
.draft{font-size:12px;font-weight:600;color:#C2410C}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
button{font:inherit;font-weight:700;font-size:15px;min-height:44px;padding:0 16px;border-radius:14px;border:1.5px solid var(--navy);background:#fff;color:var(--navy);cursor:pointer}
button.ok{background:var(--green);color:#fff}button.rec{background:var(--orange);color:#fff}button.recording{background:var(--red);color:#fff}
button:disabled{opacity:.4;cursor:default}
.status{font-weight:700;font-size:13px;color:var(--green)}.stale{color:#C2410C}.note{font-size:13px;color:var(--muted)}
</style></head><body>
<header><div class="kick">Novi · studio voix</div><h1>Eʋegbe</h1>
<div class="top"><b id="count"></b><span id="mode"></span></div><div class="bar"><div id="fill" style="width:0"></div></div>
<div class="chips"><span class="chip on" data-f="todo" id="cTodo"></span><span class="chip" data-f="done" id="cDone"></span><span class="chip" data-f="all" id="cAll">Toutes</span></div></header>
<main id="list"></main>
<script>
let all=[],filter="todo",rec=null;
const $=s=>document.querySelector(s);
async function load(){const r=await (await fetch("/api/sentences")).json();all=r.sentences;$("#mode").textContent=r.drafts?"Brouillons de Claude affichés":"";render();}
function done(s){return s.kept&&s.kept.current}
function render(){
  const voiced=all.filter(s=>!s.dynamic);const ok=voiced.filter(done).length;
  $("#count").textContent=ok+" sur "+voiced.length+" validées";$("#fill").style.width=(voiced.length?ok/voiced.length*100:0)+"%";
  $("#cTodo").textContent="À écouter · "+(voiced.length-ok);$("#cDone").textContent="Faites · "+ok;
  document.querySelectorAll(".chip").forEach(c=>c.classList.toggle("on",c.dataset.f===filter));
  const shown=all.filter(s=>filter==="all"||(filter==="done"?done(s):!done(s)));
  $("#list").innerHTML="";
  for(const s of shown){
    const el=document.createElement("div");el.className="card";
    el.innerHTML=\`<div class="fr">\${esc(s.fr)}</div>
      <textarea>\${esc(s.text)}</textarea>
      \${!s.checked&&s.text?'<span class="draft">Brouillon de Claude : corrigez si besoin</span>':""}
      \${s.dynamic?'<span class="note">Contient un prénom ou un montant : il reste écrit à l’écran, la voix ne le dit pas.</span>':""}
      <div class="row">
        <button data-a="save">Enregistrer le texte</button>
        <button data-a="machine" \${s.machine?"":"disabled"}>▶ Voix machine</button>
        <button class="ok" data-a="approve" \${s.machine?"":"disabled"}>✓ Ça sonne juste</button>
        <button class="rec" data-a="record" \${s.text&&!s.dynamic?"":"disabled"}>● Enregistrer avec ma voix</button>
        \${s.kept?'<button data-a="final">▶ Gardée</button><button data-a="remove">Retirer</button>':""}
      </div>
      \${s.kept?(s.kept.current?'<span class="status">✓ Gardée ('+(s.kept.how==="own"?"votre voix":"voix machine")+')</span>':'<span class="status stale">Le texte a changé : réécoutez et gardez de nouveau</span>'):""}
      \${!s.machine&&s.text&&!s.dynamic?'<span class="note">Pas encore de voix machine pour ce texte : lancez py scripts/ewe_voice.py</span>':""}
      <span class="key">\${s.key}</span>\`;
    el.querySelectorAll("button").forEach(b=>b.onclick=()=>act(s,b,el));
    $("#list").appendChild(el);
  }
}
const esc=t=>String(t??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
async function post(path,body,type){const r=await fetch(path,{method:"POST",headers:{"Content-Type":type||"application/json"},body});const j=await r.json();if(!r.ok)alert(j.error);return r.ok;}
async function act(s,b,el){
  const a=b.dataset.a;
  if(a==="save"){if(await post("/api/text/"+s.key,JSON.stringify({text:el.querySelector("textarea").value})))load();}
  if(a==="machine")new Audio("/audio/machine/"+s.key+"?"+Date.now()).play();
  if(a==="final")new Audio("/audio/final/"+s.key+"?"+Date.now()).play();
  if(a==="approve"&&await post("/api/approve/"+s.key))load();
  if(a==="remove"&&await post("/api/remove/"+s.key))load();
  if(a==="record"){
    if(rec){const wav=await rec.stop();rec=null;b.classList.remove("recording");b.textContent="● Enregistrer avec ma voix";
      new Audio(URL.createObjectURL(new Blob([wav],{type:"audio/wav"}))).play();
      if(confirm("Garder cet enregistrement ?")&&await post("/api/record/"+s.key,wav,"audio/wav"))load();}
    else{rec=await record();b.classList.add("recording");b.textContent="■ Arrêter";}
  }
}
// Records the microphone as a 22 kHz mono WAV, which every phone can play.
async function record(){
  const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
  const ctx=new AudioContext();const src=ctx.createMediaStreamSource(stream);const node=ctx.createScriptProcessor(4096,1,1);const parts=[];
  node.onaudioprocess=e=>parts.push(new Float32Array(e.inputBuffer.getChannelData(0)));src.connect(node);node.connect(ctx.destination);
  return{async stop(){node.disconnect();src.disconnect();stream.getTracks().forEach(t=>t.stop());const rate=ctx.sampleRate;await ctx.close();
    const len=parts.reduce((n,p)=>n+p.length,0);const all=new Float32Array(len);let o=0;for(const p of parts){all.set(p,o);o+=p.length;}
    const out=22050,ratio=rate/out,n=Math.floor(len/ratio),pcm=new Int16Array(n);let peak=0;for(let i=0;i<len;i++)peak=Math.max(peak,Math.abs(all[i]));
    const gain=peak>0?Math.min(4,0.9/peak):1;for(let i=0;i<n;i++){const v=Math.max(-1,Math.min(1,all[Math.floor(i*ratio)]*gain));pcm[i]=v*32767;}
    const buf=new ArrayBuffer(44+pcm.length*2),d=new DataView(buf),w=(p,s)=>[...s].forEach((c,i)=>d.setUint8(p+i,c.charCodeAt(0)));
    w(0,"RIFF");d.setUint32(4,36+pcm.length*2,true);w(8,"WAVE");w(12,"fmt ");d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);
    d.setUint32(24,out,true);d.setUint32(28,out*2,true);d.setUint16(32,2,true);d.setUint16(34,16,true);w(36,"data");d.setUint32(40,pcm.length*2,true);
    new Int16Array(buf,44).set(pcm);return new Uint8Array(buf);}};
}
document.querySelectorAll(".chip").forEach(c=>c.onclick=()=>{filter=c.dataset.f;render();});
load();
</script></body></html>`;
