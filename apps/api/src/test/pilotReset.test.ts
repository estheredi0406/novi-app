import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { resetPilotData } from "../services/pilotReset.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

// D93: the pilot can start again from zero groups, keeping its members.

const as = (token: string) => ({
  post: (path: string, body?: object) =>
    request(app)
      .post(path)
      .set("Authorization", `Bearer ${token}`)
      .send(body ?? {}),
  get: (path: string) => request(app).get(path).set("Authorization", `Bearer ${token}`),
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function runningGroup() {
  const a = await signedUpMember();
  const b = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
  const c = await signedUpMember("+22890000003", undefined, KOFFI, "Koffi");
  const org = as(a.tokens.accessToken);
  const groupId = (
    await org.post("/v1/groups", {
      name: "Pagnes Assigamé",
      amountFcfa: 5000,
      frequency: "WEEKLY",
      dueDay: 5,
      size: 3,
      payoutOrder: "DRAWN",
    })
  ).body.id as string;
  await org.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
  await org.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000003" });
  await org.post(`/v1/groups/${groupId}/propose`, { shareConsent: true });
  await as(b.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version: 1, shareConsent: true });
  await as(c.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version: 1, shareConsent: true });
  await org.post(`/v1/groups/${groupId}/start`);
  await org.post(`/v1/groups/${groupId}/messages`, { body: "Bonjour à toutes" });
  return { org, groupId };
}

describe("pilot reset (D93)", () => {
  it("refuses outside the pilot", async () => {
    vi.stubEnv("PILOT_SHOW_CODES", "false");
    await expect(resetPilotData()).rejects.toThrow(/pilot/);
  });

  it("erases every group, its money and its chat, and keeps the members, who can start again", async () => {
    vi.stubEnv("PILOT_SHOW_CODES", "true");
    const { org } = await runningGroup();
    expect(await prisma.group.count()).toBe(1);
    expect(await prisma.ledgerEntry.count()).toBeGreaterThanOrEqual(0);

    await resetPilotData();

    expect(await prisma.group.count()).toBe(0);
    expect(await prisma.round.count()).toBe(0);
    expect(await prisma.groupMessage.count()).toBe(0);
    expect(await prisma.ledgerEntry.count()).toBe(0);
    expect(await prisma.user.count()).toBe(3);
    // Her session still works, she sees no group, and she can create one.
    expect((await org.get("/v1/groups")).body).toEqual([]);
    const again = await org.post("/v1/groups", {
      name: "Nouveau départ",
      amountFcfa: 1000,
      frequency: "DAILY",
      dueDay: 1,
      size: 3,
      payoutOrder: "DRAWN",
    });
    expect(again.status).toBe(201);
  });
});
