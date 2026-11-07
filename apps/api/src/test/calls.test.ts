import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { app } from "../app.js";
import { type CallPass, readPass, signPass } from "../lib/callPass.js";
import { NoviMeetingProvider } from "../providers/meeting/NoviMeetingProvider.js";
import { attachCallSignal, roomSize } from "../services/callSignal.js";

// D112: Novi's own group calls. The pass, the page, and the signalling
// server that introduces the phones to each other.

const now = () => Math.floor(Date.now() / 1000);
const pass = (over: Partial<CallPass> = {}): CallPass => ({
  room: "novi-test",
  uid: "u1",
  name: "Ama Mensah",
  owner: false,
  max: 15,
  nbf: now() - 60,
  exp: now() + 600,
  lang: "fr",
  ...over,
});

type Message = { type: string; [key: string]: unknown };

// A test phone: a WebSocket that keeps every message it receives.
function phone(base: string, token: string) {
  const ws = new WebSocket(`${base}/v1/call-signal?t=${encodeURIComponent(token)}`);
  const inbox: Message[] = [];
  ws.on("message", (raw) => inbox.push(JSON.parse(String(raw)) as Message));
  const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
  async function next(type: string): Promise<Message> {
    for (let i = 0; i < 100; i += 1) {
      const found = inbox.findIndex((m) => m.type === type);
      if (found >= 0) return inbox.splice(found, 1)[0] as Message;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`No "${type}" message`);
  }
  return { ws, inbox, next, closed };
}

describe("call pass", () => {
  it("reads back what it signed", () => {
    const p = pass();
    expect(readPass(signPass(p))).toEqual(p);
  });

  it("refuses a changed pass", () => {
    const [body, mac = ""] = signPass(pass()).split(".");
    const forged = Buffer.from(JSON.stringify(pass({ owner: true }))).toString("base64url");
    expect(readPass(`${forged}.${mac}`)).toBeNull();
    expect(readPass(`${body}.x${mac.slice(1)}`)).toBeNull();
    expect(readPass("nonsense")).toBeNull();
  });

  it("refuses a pass before the room opens or after it closes", () => {
    expect(readPass(signPass(pass({ nbf: now() + 60 })))).toBeNull();
    expect(readPass(signPass(pass({ exp: now() - 1 })))).toBeNull();
  });
});

describe("call provider", () => {
  it("gives a link to Novi's own page, carrying a pass for that member", async () => {
    const provider = new NoviMeetingProvider("https://novi.example");
    const closesAt = new Date(Date.now() + 30 * 60_000);
    const room = await provider.createRoom({ name: "novi-abc", opensAt: new Date(), closesAt, maxParticipants: 6 });
    expect(room.url).toBe("https://novi.example/call/novi-abc");
    const link = await provider.joinUrl({
      roomName: "novi-abc",
      roomUrl: room.url,
      userId: "u9",
      userName: "Kossiwa",
      isOwner: true,
      closesAt,
      lang: "en",
    });
    const token = new URL(link).searchParams.get("t") ?? "";
    expect(link.startsWith("https://novi.example/call/novi-abc?t=")).toBe(true);
    expect(readPass(token)).toMatchObject({ room: "novi-abc", uid: "u9", name: "Kossiwa", owner: true, max: 6, lang: "en" });
  });
});

describe("call page", () => {
  it("is served with a strict content policy and no caching", async () => {
    const res = await request(app).get("/call/novi-abc");
    expect(res.status).toBe(200);
    expect(res.text).toContain("RTCPeerConnection");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });
});

describe("call signalling", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer();
    attachCallSignal(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("introduces a newcomer to those already in the room, and relays between them", async () => {
    const ama = phone(base, signPass(pass({ room: "r1", uid: "a", name: "Ama" })));
    const welcomeA = await ama.next("welcome");
    expect(welcomeA.peers).toEqual([]);
    expect((welcomeA.ice as { urls: string[] }[])[0]?.urls.length).toBeGreaterThan(0);

    const efua = phone(base, signPass(pass({ room: "r1", uid: "e", name: "Efua" })));
    const welcomeE = await efua.next("welcome");
    expect(welcomeE.peers).toEqual([{ id: welcomeA.you, name: "Ama", muted: false }]);
    const joined = await ama.next("joined");
    expect(joined).toMatchObject({ id: welcomeE.you, name: "Efua" });

    // Efua's phone sends its offer to Ama; the server only passes it on.
    efua.ws.send(JSON.stringify({ type: "signal", to: welcomeA.you, data: { sdp: { type: "offer", sdp: "x" } } }));
    expect(await ama.next("signal")).toEqual({ type: "signal", from: welcomeE.you, data: { sdp: { type: "offer", sdp: "x" } } });

    // Muting is shown to the others.
    ama.ws.send(JSON.stringify({ type: "state", muted: true }));
    expect(await efua.next("state")).toEqual({ type: "state", id: welcomeA.you, muted: true });

    expect(roomSize("r1")).toBe(2);
    efua.ws.close();
    expect(await ama.next("left")).toEqual({ type: "left", id: welcomeE.you });
    ama.ws.close();
    await ama.closed;
    expect(roomSize("r1")).toBe(0);
  });

  it("refuses a bad pass", async () => {
    const stranger = phone(base, "not-a-pass");
    expect(await stranger.next("refused")).toEqual({ type: "refused", reason: "pass" });
    expect(await stranger.closed).toBe(4001);
  });

  it("refuses a member when the room is full", async () => {
    const one = phone(base, signPass(pass({ room: "r2", uid: "1", max: 1 })));
    await one.next("welcome");
    const two = phone(base, signPass(pass({ room: "r2", uid: "2", max: 1 })));
    expect(await two.next("refused")).toEqual({ type: "refused", reason: "full" });
    one.ws.close();
    await one.closed;
  });

  it("lets the same member in again from another phone, and the old one leaves", async () => {
    const first = phone(base, signPass(pass({ room: "r3", uid: "k" })));
    await first.next("welcome");
    const second = phone(base, signPass(pass({ room: "r3", uid: "k" })));
    expect((await second.next("welcome")).peers).toEqual([]);
    expect(await first.closed).toBe(4002);
    expect(roomSize("r3")).toBe(1);
    second.ws.close();
    await second.closed;
  });

  it("lets only the organiser mute someone or take her out, and keeps her out", async () => {
    const kossi = phone(base, signPass(pass({ room: "r5", uid: "o", owner: true })));
    await kossi.next("welcome");
    const ama = phone(base, signPass(pass({ room: "r5", uid: "a" })));
    const welcomeA = await ama.next("welcome");
    const organiser = (welcomeA.peers as { id: string }[])[0]?.id;
    const amaId = welcomeA.you as string;

    // A member cannot use the organiser's controls.
    ama.ws.send(JSON.stringify({ type: "remove", to: organiser }));
    kossi.ws.send(JSON.stringify({ type: "mute", to: amaId }));
    expect(await ama.next("muted-by-organiser")).toEqual({ type: "muted-by-organiser" });
    expect(roomSize("r5")).toBe(2);

    kossi.ws.send(JSON.stringify({ type: "remove", to: amaId }));
    expect(await ama.next("refused")).toEqual({ type: "refused", reason: "removed" });
    expect(await ama.closed).toBe(4004);
    expect(await kossi.next("left")).toEqual({ type: "left", id: amaId });

    const again = phone(base, signPass(pass({ room: "r5", uid: "a" })));
    expect(await again.next("refused")).toEqual({ type: "refused", reason: "removed" });
    kossi.ws.close();
    await kossi.closed;
  });

  it("ends the call for everyone when the room closes", async () => {
    const ama = phone(base, signPass(pass({ room: "r4", uid: "a", exp: now() + 1 })));
    await ama.next("welcome");
    expect(await ama.next("ended")).toEqual({ type: "ended", reason: "ended" });
    expect(await ama.closed).toBe(4000);
  }, 5000);
});
