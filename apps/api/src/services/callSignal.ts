import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { readPass } from "../lib/callPass.js";

// D112: group calls without a call service. The voice goes phone to phone
// (WebRTC); the server only passes the connection details and never hears the
// call. Without a relay server, some mobile networks may block the call, and
// a voice note is the backup.

type Peer = { id: string; uid: string; name: string; owner: boolean; muted: boolean; socket: WebSocket };
// removed: members the organiser took out; their pass no longer lets them in.
type Room = { peers: Map<string, Peer>; closer: NodeJS.Timeout; removed: Set<string> };

const rooms = new Map<string, Room>();
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

export function iceServers(): { urls: string[] }[] {
  const urls = (process.env.CALL_STUN ?? "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  return [{ urls }];
}

function send(socket: WebSocket, message: object) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room: Room, message: object, except?: string) {
  for (const peer of room.peers.values()) if (peer.id !== except) send(peer.socket, message);
}

// Called when a meeting is cancelled, or by the room's own timer at its end.
export function closeRoom(name: string, reason = "ended") {
  const room = rooms.get(name);
  if (!room) return;
  clearTimeout(room.closer);
  for (const peer of room.peers.values()) {
    send(peer.socket, { type: "ended", reason });
    peer.socket.close(4000, reason);
  }
  rooms.delete(name);
}

function join(socket: WebSocket, token: string) {
  const pass = readPass(token);
  if (!pass) {
    send(socket, { type: "refused", reason: "pass" });
    socket.close(4001, "pass");
    return;
  }
  let room = rooms.get(pass.room);
  if (!room) {
    const closer = setTimeout(() => closeRoom(pass.room), Math.max(0, pass.exp * 1000 - Date.now()));
    closer.unref();
    room = { peers: new Map(), closer, removed: new Set() };
    rooms.set(pass.room, room);
  }
  if (room.removed.has(pass.uid)) {
    send(socket, { type: "refused", reason: "removed" });
    socket.close(4004, "removed");
    return;
  }
  // The same member on a second phone, or reconnecting: the old one leaves.
  for (const old of room.peers.values()) {
    if (old.uid === pass.uid) {
      room.peers.delete(old.id);
      broadcast(room, { type: "left", id: old.id });
      old.socket.close(4002, "replaced");
    }
  }
  if (room.peers.size >= pass.max) {
    send(socket, { type: "refused", reason: "full" });
    socket.close(4003, "full");
    return;
  }

  const me: Peer = { id: randomUUID(), uid: pass.uid, name: pass.name, owner: pass.owner, muted: false, socket };
  const others = [...room.peers.values()].map((p) => ({ id: p.id, name: p.name, muted: p.muted }));
  room.peers.set(me.id, me);
  // The newcomer calls each member already there; they answer.
  send(socket, { type: "welcome", you: me.id, owner: me.owner, peers: others, ice: iceServers(), closesAt: pass.exp * 1000 });
  broadcast(room, { type: "joined", id: me.id, name: me.name, muted: false }, me.id);

  const current = room;
  socket.on("message", (raw) => {
    let message: { type?: string; to?: string; data?: unknown; muted?: boolean };
    try {
      message = JSON.parse(String(raw)) as typeof message;
    } catch {
      return;
    }
    if (message.type === "signal" && typeof message.to === "string") {
      const target = current.peers.get(message.to);
      if (target) send(target.socket, { type: "signal", from: me.id, data: message.data });
    } else if (message.type === "state" && typeof message.muted === "boolean") {
      me.muted = message.muted;
      broadcast(current, { type: "state", id: me.id, muted: me.muted }, me.id);
    } else if (me.owner && typeof message.to === "string" && (message.type === "mute" || message.type === "remove")) {
      // The organiser's controls (D71): mute someone (a noisy market; she can
      // speak again herself), or take her out of this call for good.
      const target = current.peers.get(message.to);
      if (!target || target.id === me.id) return;
      if (message.type === "mute") {
        send(target.socket, { type: "muted-by-organiser" });
      } else {
        current.removed.add(target.uid);
        current.peers.delete(target.id);
        send(target.socket, { type: "refused", reason: "removed" });
        target.socket.close(4004, "removed");
        broadcast(current, { type: "left", id: target.id });
      }
    }
  });
  socket.on("close", () => {
    if (current.peers.get(me.id)?.socket !== socket) return;
    current.peers.delete(me.id);
    broadcast(current, { type: "left", id: me.id });
    if (current.peers.size === 0 && rooms.get(pass.room) === current) {
      clearTimeout(current.closer);
      rooms.delete(pass.room);
    }
  });
}

// Attached to the HTTP server: /v1/call-signal?t=<pass> becomes a WebSocket.
export function attachCallSignal(server: Server) {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://novi");
    if (url.pathname !== "/v1/call-signal") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => join(ws, url.searchParams.get("t") ?? ""));
  });
  // Phones on mobile networks drop quietly: a ping every 25 s keeps the line
  // open through proxies and notices a phone that is gone.
  const ping = setInterval(() => {
    for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, 25_000);
  ping.unref();
}

// For tests: how many are in a room now.
export function roomSize(name: string): number {
  return rooms.get(name)?.peers.size ?? 0;
}
