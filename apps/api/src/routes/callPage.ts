import { Router } from "express";

// D112: the call page, served by the API and opened inside Novi (D85). Plain
// HTML and WebRTC, no outside script; the voice goes phone to phone.
export const callPageRouter = Router();

callPageRouter.get("/:room", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  // The page may use the microphone, and only talks to this server.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' wss: ws:; media-src 'self' blob: mediastream:",
  );
  res.type("html").send(PAGE);
});

const PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Novi</title>
<style>
  :root { --indigo:#06294A; --lagoon:#0B4F8A; --onDark:#F3F7FB; --mist:#E3F2F8; --orange:#F05A1A; --muted:#A9C6DA; }
  * { box-sizing:border-box; }
  html, body { margin:0; height:100%; background:var(--indigo); color:var(--onDark);
    font-family: "Noto Sans", system-ui, -apple-system, Roboto, sans-serif; }
  body { display:flex; flex-direction:column; padding:20px 16px calc(24px + env(safe-area-inset-bottom)); }
  .head { text-align:center; }
  .head b { font-size:20px; display:block; }
  .head span { font-size:15px; opacity:.8; }
  .grid { flex:1; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:22px 10px; align-content:center; padding:16px 0; }
  .p { display:flex; flex-direction:column; align-items:center; gap:8px; font-size:15px; text-align:center; }
  .av { position:relative; width:88px; height:88px; border-radius:44px; background:var(--lagoon);
    display:flex; align-items:center; justify-content:center; font-weight:700; font-size:28px; transition:box-shadow .15s; }
  .me .av { background:var(--mist); color:var(--indigo); }
  .talk .av { box-shadow:0 0 0 4px var(--onDark); }
  .wait .av { background:transparent; border:2px dashed var(--muted); }
  .muteb { position:absolute; right:0; bottom:0; width:28px; height:28px; border-radius:14px; background:var(--onDark);
    display:none; align-items:center; justify-content:center; }
  .muted .muteb { display:flex; }
  .sub { font-size:13px; opacity:.75; margin-top:-6px; min-height:16px; }
  .note { text-align:center; font-size:14px; opacity:.85; line-height:20px; margin:0 8px 16px; min-height:20px; }
  .bar { display:flex; justify-content:center; gap:28px; }
  .ctl { display:flex; flex-direction:column; align-items:center; gap:6px; font-size:13px; }
  button.round { width:64px; height:64px; border-radius:32px; border:0; display:flex; align-items:center; justify-content:center;
    background:rgba(255,255,255,.14); cursor:pointer; }
  button.round.off { background:var(--onDark); }
  button.round.leave { background:var(--orange); }
  .acts { display:none; gap:6px; flex-direction:column; }
  .open .acts { display:flex; }
  .acts button { min-height:36px; padding:0 12px; border-radius:18px; border:0; font-size:13px; font-weight:700;
    background:var(--onDark); color:var(--indigo); }
  .acts button.out { background:var(--orange); color:#fff; }
  button.wide { margin:0 auto 14px; display:none; min-height:48px; padding:0 22px; border-radius:24px; border:0;
    background:var(--onDark); color:var(--indigo); font-weight:700; font-size:16px; }
</style>
</head>
<body>
  <div class="head"><b id="title"></b><span id="clock"></span></div>
  <div class="grid" id="grid"></div>
  <p class="note" id="note"></p>
  <button class="wide" id="sound"></button>
  <div class="bar">
    <div class="ctl"><button class="round" id="mic" aria-label=""></button><span id="micLabel"></span></div>
    <div class="ctl"><button class="round leave" id="leave" aria-label=""></button><span id="leaveLabel"></span></div>
  </div>
<script>
(function () {
  var MIC = '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v3" stroke="COLOR" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>';
  var MICOFF = '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v3M4 4l16 16" stroke="COLOR" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>';
  var HANG = '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14c5-5 13-5 18 0l-2 3-4-1v-3a10 10 0 0 0-6 0v3l-4 1z" fill="#fff"/></svg>';
  var T = {
    fr: { title:"Appel du groupe", you:"Vous", mic:"Micro", leave:"Quitter", talking:"parle", muted:"micro coupé",
      joining:"connexion…", failed:"connexion impossible", weak:"Réseau faible ? Envoyez plutôt une note vocale.",
      alone:"Vous êtes seule pour l'instant. Les autres sont prévenus.", ended:"L'appel est terminé.",
      refused:"Ce lien n'est plus valable. Rouvrez l'appel depuis le groupe.", full:"L'appel est complet.",
      noMic:"Novi n'a pas accès au micro. Autorisez-le dans les réglages du téléphone.", lost:"Connexion perdue. Rouvrez l'appel depuis le groupe.",
      sound:"Activer le son", muteThem:"Couper son micro", removeThem:"Retirer de l'appel",
      removed:"L'organisatrice vous a retirée de cet appel.", mutedYou:"L'organisatrice a coupé votre micro. Touchez Micro pour reparler.",
      people:function(n){ return n + (n > 1 ? " personnes" : " personne"); } },
    en: { title:"Group call", you:"You", mic:"Mic", leave:"Leave", talking:"talking", muted:"muted",
      joining:"connecting…", failed:"cannot connect", weak:"Weak network? Send a voice note instead.",
      alone:"You are alone for now. The others have been told.", ended:"The call has ended.",
      refused:"This link is no longer valid. Open the call again from the group.", full:"The call is full.",
      noMic:"Novi cannot use the microphone. Allow it in the phone's settings.", lost:"Connection lost. Open the call again from the group.",
      sound:"Turn on sound", muteThem:"Mute her", removeThem:"Remove from call",
      removed:"The organiser removed you from this call.", mutedYou:"The organiser muted you. Tap Mic to speak again.",
      people:function(n){ return n + (n > 1 ? " people" : " person"); } }
  };
  var token = new URLSearchParams(location.search).get("t") || "";
  var pass = {};
  try { pass = JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))); } catch (e) {}
  var L = T[pass.lang === "en" ? "en" : "fr"];
  document.documentElement.lang = pass.lang === "en" ? "en" : "fr";
  var $ = function (id) { return document.getElementById(id); };
  $("title").textContent = L.title;
  $("micLabel").textContent = L.mic; $("leaveLabel").textContent = L.leave;
  $("mic").setAttribute("aria-label", L.mic); $("leave").setAttribute("aria-label", L.leave);
  $("leave").innerHTML = HANG;
  $("sound").textContent = L.sound;

  var initials = function (name) {
    return (name || "?").split(/\\s+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase();
  };
  var peers = {}; // id -> { name, pc, tile, audio, pending, level }
  var me = null, amOwner = false, ws = null, local = null, ice = [], muted = false, closed = false, started = Date.now();
  var audioCtx = null;

  function note(text) { $("note").textContent = text || ""; }
  function count() {
    var n = 1 + Object.keys(peers).length;
    var m = Math.floor((Date.now() - started) / 60000), s = Math.floor((Date.now() - started) / 1000) % 60;
    $("clock").textContent = L.people(n) + " · " + m + ":" + (s < 10 ? "0" : "") + s;
    if (n === 1 && !closed) note(L.alone); else if ($("note").textContent === L.alone) note("");
  }
  setInterval(count, 1000);

  function tile(id, name, isMe) {
    var el = document.createElement("div");
    el.className = "p wait" + (isMe ? " me" : "");
    el.innerHTML = '<div class="av"><span></span><span class="muteb">' + MICOFF.replace("COLOR", "#06294A").replace('width="26" height="26"', 'width="16" height="16"') + '</span></div><b></b><span class="sub"></span>';
    el.querySelector(".av span").textContent = initials(name);
    el.querySelector("b").textContent = isMe ? L.you : (name || "").split(" ")[0];
    if (!isMe) {
      // The organiser taps someone to mute her or take her out (D71).
      var acts = document.createElement("div"); acts.className = "acts";
      var m = document.createElement("button"); m.textContent = L.muteThem;
      var r = document.createElement("button"); r.textContent = L.removeThem; r.className = "out";
      m.onclick = function (e) { e.stopPropagation(); order("mute", id); el.classList.remove("open"); };
      r.onclick = function (e) { e.stopPropagation(); order("remove", id); el.classList.remove("open"); };
      acts.appendChild(m); acts.appendChild(r); el.appendChild(acts);
      el.onclick = function () { if (amOwner) el.classList.toggle("open"); };
    }
    $("grid").appendChild(el);
    return el;
  }
  function setSub(el, text) { el.querySelector(".sub").textContent = text || ""; }

  // A soft ring around whoever is speaking: the loudness of each voice.
  function watch(stream, holder) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var src = audioCtx.createMediaStreamSource(stream);
      var an = audioCtx.createAnalyser(); an.fftSize = 512; src.connect(an);
      var data = new Uint8Array(an.fftSize);
      holder.level = function () {
        an.getByteTimeDomainData(data);
        var sum = 0; for (var i = 0; i < data.length; i++) { var v = (data[i] - 128) / 128; sum += v * v; }
        return Math.sqrt(sum / data.length);
      };
    } catch (e) {}
  }
  var self = { level: null, tile: null };
  function loop() {
    var all = [self].concat(Object.keys(peers).map(function (k) { return peers[k]; }));
    all.forEach(function (p) {
      if (!p.tile || !p.level) return;
      var talking = p.level() > 0.04 && !(p === self && muted);
      p.tile.classList.toggle("talk", talking);
    });
    requestAnimationFrame(loop);
  }

  function order(type, id) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: type, to: id })); }
  function signal(to, data) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "signal", to: to, data: data })); }

  function connect(id, name, initiator) {
    var p = peers[id] || (peers[id] = { name: name, tile: tile(id, name, false), pending: [] });
    if (p.pc) return p;
    var pc = new RTCPeerConnection({ iceServers: ice });
    p.pc = pc;
    local.getTracks().forEach(function (t) { pc.addTrack(t, local); });
    pc.onicecandidate = function (e) { if (e.candidate) signal(id, { candidate: e.candidate }); };
    pc.ontrack = function (e) {
      if (!p.audio) { p.audio = new Audio(); p.audio.autoplay = true; p.audio.setAttribute("playsinline", ""); }
      p.audio.srcObject = e.streams[0];
      p.audio.play().catch(function () { $("sound").style.display = "block"; });
      watch(e.streams[0], p);
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === "connected") { p.tile.classList.remove("wait"); setSub(p.tile, p.muted ? L.muted : ""); }
      if (pc.connectionState === "failed") { setSub(p.tile, L.failed); note(L.weak); }
    };
    setSub(p.tile, L.joining);
    if (initiator) {
      pc.createOffer().then(function (o) { return pc.setLocalDescription(o); })
        .then(function () { signal(id, { sdp: pc.localDescription }); });
    }
    return p;
  }

  function onSignal(from, data) {
    // A member who just joined calls us: make our side of her line now.
    var p = connect(from, peers[from] ? peers[from].name : "", false);
    var pc = p.pc;
    if (data.sdp) {
      pc.setRemoteDescription(data.sdp).then(function () {
        p.pending.forEach(function (c) { pc.addIceCandidate(c).catch(function () {}); }); p.pending = [];
        if (data.sdp.type === "offer") {
          return pc.createAnswer().then(function (a) { return pc.setLocalDescription(a); })
            .then(function () { signal(from, { sdp: pc.localDescription }); });
        }
      }).catch(function () {});
    } else if (data.candidate) {
      if (pc.remoteDescription) pc.addIceCandidate(data.candidate).catch(function () {});
      else p.pending.push(data.candidate);
    }
  }

  function drop(id) {
    var p = peers[id]; if (!p) return;
    if (p.pc) p.pc.close();
    if (p.audio) p.audio.srcObject = null;
    if (p.tile) p.tile.remove();
    delete peers[id];
  }

  function end(text) {
    closed = true;
    Object.keys(peers).forEach(drop);
    if (local) local.getTracks().forEach(function (t) { t.stop(); });
    if (ws) try { ws.close(); } catch (e) {}
    note(text);
  }

  function leave() {
    end("");
    // Inside Novi, the app closes the page; in a browser, the page simply ends.
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage("leave");
  }
  $("leave").onclick = leave;
  $("sound").onclick = function () {
    Object.keys(peers).forEach(function (k) { if (peers[k].audio) peers[k].audio.play().catch(function () {}); });
    if (audioCtx) audioCtx.resume();
    $("sound").style.display = "none";
  };
  function drawMic() {
    $("mic").innerHTML = (muted ? MICOFF : MIC).replace("COLOR", muted ? "#06294A" : "#F3F7FB");
    $("mic").classList.toggle("off", muted);
    self.tile && self.tile.classList.toggle("muted", muted);
  }
  $("mic").onclick = function () {
    muted = !muted;
    local && local.getAudioTracks().forEach(function (t) { t.enabled = !muted; });
    drawMic();
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "state", muted: muted }));
  };
  drawMic();

  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
    .then(function (stream) {
      local = stream;
      self.tile = tile("me", pass.name, true); self.tile.classList.remove("wait");
      watch(stream, self); requestAnimationFrame(loop);
      var proto = location.protocol === "https:" ? "wss://" : "ws://";
      ws = new WebSocket(proto + location.host + "/v1/call-signal?t=" + encodeURIComponent(token));
      ws.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (x) { return; }
        if (m.type === "welcome") {
          me = m.you; ice = m.ice; amOwner = !!m.owner;
          // The newcomer calls everyone already in the room.
          m.peers.forEach(function (p) { var x = connect(p.id, p.name, true); x.muted = p.muted; });
          count();
        } else if (m.type === "joined") {
          // She will call us: show her while she connects.
          peers[m.id] = peers[m.id] || { name: m.name, tile: tile(m.id, m.name, false), pending: [] };
          setSub(peers[m.id].tile, L.joining);
          count();
        } else if (m.type === "signal") {
          onSignal(m.from, m.data);
        } else if (m.type === "state") {
          var p = peers[m.id]; if (p) { p.muted = m.muted; p.tile.classList.toggle("muted", m.muted); setSub(p.tile, m.muted ? L.muted : ""); }
        } else if (m.type === "left") {
          drop(m.id); count();
        } else if (m.type === "muted-by-organiser") {
          if (!muted) $("mic").onclick();
          note(L.mutedYou);
        } else if (m.type === "ended") {
          end(L.ended);
        } else if (m.type === "refused") {
          end(m.reason === "full" ? L.full : m.reason === "removed" ? L.removed : L.refused);
        }
      };
      ws.onclose = function () { if (!closed) end(L.lost); };
    })
    .catch(function () { note(L.noMic); });
})();
</script>
</body>
</html>`;
