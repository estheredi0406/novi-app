import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

// Novi by USSD, through Africa's Talking's gateway (D73). The gateway posts
// a form at each key press and shows the plain-text answer.

const TOKEN = "test-ussd-token-0123456789";
const SMALL_GROUP = {
  name: "Pagnes Assigamé",
  amountFcfa: 5000,
  frequency: "WEEKLY",
  dueDay: 5,
  size: 3,
  payoutOrder: "DRAWN",
};

function as(accessToken: string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  return {
    post: (path: string, body?: object) =>
      auth(
        request(app)
          .post(path)
          .send(body ?? {}),
      ),
  };
}

// What the gateway sends: everything typed so far, joined by "*".
const dial = (phoneNumber: string, text: string, token = TOKEN) =>
  request(app)
    .post(`/v1/ussd/africastalking/${token}`)
    .type("form")
    .send({ sessionId: "ATUid_test", serviceCode: "*384*123#", phoneNumber, networkCode: "99999", text });

async function startedGroup() {
  const people = [
    await signedUpMember(),
    await signedUpMember("+22890000002", undefined, ABLA, "Abla"),
    await signedUpMember("+22890000003", undefined, KOFFI, "Koffi"),
  ];
  const [akossiwa, abla, koffi] = people.map((p) => as(p.tokens.accessToken));
  const groupId = (await akossiwa!.post("/v1/groups", SMALL_GROUP)).body.id as string;
  await akossiwa!.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
  await akossiwa!.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000003" });
  await akossiwa!.post(`/v1/groups/${groupId}/propose`);
  await abla!.post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await koffi!.post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await akossiwa!.post(`/v1/groups/${groupId}/start`);
  return groupId;
}

beforeEach(() => {
  vi.stubEnv("USSD_CALLBACK_TOKEN", TOKEN);
  vi.stubEnv("PILOT_SHOW_CODES", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the USSD gateway's callback", () => {
  it("does not exist without the secret in its address, or when no secret is set", async () => {
    expect((await dial("+22890000001", "", "wrong-token-000000000")).status).toBe(404);
    vi.stubEnv("USSD_CALLBACK_TOKEN", "");
    expect((await dial("+22890000001", "")).status).toBe(404);
  });

  it("asks for the PIN, then shows the menu, as plain text starting with CON or END", async () => {
    await signedUpMember();
    const first = await dial("+22890000001", "");
    expect(first.type).toBe("text/plain");
    expect(first.text).toBe("CON Novi\nEntrez votre code PIN :");
    expect((await dial("+22890000001", "4829")).text).toMatch(/^CON Novi\n1\. Payer ma cotisation/);
    expect((await dial("+22890000001", "4829*0")).text).toBe("END Merci d'utiliser Novi.");
  });

  it("lets any pilot account in, since every one was opened with a demo identity", async () => {
    const afiavi = { niu: "0000-000-0021", legalName: "Afiavi Enyonam Edoh", dateOfBirth: "1986-08-19" };
    await signedUpMember("+22891000021", undefined, afiavi, "Afiavi");
    expect((await dial("+22891000021", "4829")).text).toMatch(/^CON Novi\n1\. Payer ma cotisation/);
    expect((await dial("+254711000000", "")).text).toMatch(/^END /);
  });

  it("ends the session on a wrong PIN, and counts it towards the lockout", async () => {
    await signedUpMember();
    expect((await dial("+22890000001", "1111")).text).toBe("END Code PIN incorrect.");
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: "+22890000001" } });
    expect(user.failedPinAttempts).toBe(1);
  });

  it("tells a test number without an account to sign up", async () => {
    expect((await dial("+22890000009", "")).text).toContain("pas de compte Novi");
  });

  it("pays this week's contribution in four key presses", async () => {
    const groupId = await startedGroup();
    expect((await dial("+22890000002", "4829*1")).text).toContain("1. Pagnes Assigamé 5 000 F");
    expect((await dial("+22890000002", "4829*1*1")).text).toContain("Payer 5 000 F à Pagnes Assigamé, tour 1");
    const sent = await dial("+22890000002", "4829*1*1*2");
    expect(sent.text).toMatch(/^END Demande de 5 000 F envoyée/);
    const abla = await prisma.user.findUniqueOrThrow({ where: { phone: "+22890000002" } });
    const contribution = await prisma.contribution.findFirstOrThrow({ where: { userId: abla.id, round: { groupId } } });
    expect(contribution).toMatchObject({ operator: "TOGOCEL", amountFcfa: 5000 });
  });

  it("lists her groups and shows her record, each screen at most 160 characters", async () => {
    await startedGroup();
    const groups = (await dial("+22890000002", "4829*2")).text;
    expect(groups).toContain("Pagnes Assigamé : tour 1 à payer");
    const record = (await dial("+22890000002", "4829*3")).text;
    expect(record).toContain("Votre relevé Novi");
    for (const screen of [groups, record]) expect(screen.replace(/^(CON|END) /, "").length).toBeLessThanOrEqual(160);
  });
});
