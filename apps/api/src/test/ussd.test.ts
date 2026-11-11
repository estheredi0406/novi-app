import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { inviteSms } from "../lib/smsText.js";
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
const dial = (phoneNumber: string, text: string, token = TOKEN, sessionId = "ATUid_test") =>
  request(app)
    .post(`/v1/ussd/africastalking/${token}`)
    .type("form")
    .send({ sessionId, serviceCode: "*384*123#", phoneNumber, networkCode: "99999", text });
// A new call: the gateway gives each call its own session.
const call = (phoneNumber: string, text: string, sessionId: string) => dial(phoneNumber, text, TOKEN, sessionId);
const screen = (res: { text: string }) => res.text.replace(/^(CON|END) /, "");

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

  it("offers a number without an account to create one (D106)", async () => {
    expect((await dial("+22890000009", "")).text).toMatch(/^CON .*n'a pas de compte\.\n1\. Créer mon compte/s);
  });

  it("pays this week's contribution in four key presses", async () => {
    const groupId = await startedGroup();
    // Round 1: the contribution and her advance of half of it (D103).
    expect((await dial("+22890000002", "4829*1")).text).toContain("1. Pagnes Assigamé 7 500 F");
    expect((await dial("+22890000002", "4829*1*1")).text).toContain("Payer 7 500 F à Pagnes Assigamé, tour 1");
    const sent = await dial("+22890000002", "4829*1*1*2");
    expect(sent.text).toMatch(/^END Demande de 7 500 F envoyée/);
    const abla = await prisma.user.findUniqueOrThrow({ where: { phone: "+22890000002" } });
    const contribution = await prisma.contribution.findFirstOrThrow({ where: { userId: abla.id, round: { groupId } } });
    expect(contribution).toMatchObject({ operator: "TOGOCEL", amountFcfa: 7500, advanceFcfa: 2500 });
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

// D106: Enyonam has a basic phone and no account. She opens one alone.
const ENYONAM = "+22890000009"; // NIU 0000-000-0009, born 15/12/1983 in the demo register

async function codeSent(phone = ENYONAM) {
  for (const [typed, expected] of [
    ["1", /^CON Pour ouvrir votre compte/],
    ["1*1", /^CON Votre NIU/],
    ["1*1*00000000009", /^CON Votre date de naissance/],
  ] as const) {
    expect((await call(phone, typed, "call-1")).text).toMatch(expected);
  }
  const sent = await call(phone, "1*1*00000000009*15121983", "call-1");
  expect(sent.text).toMatch(/^END L'ANID envoie un code par SMS au \+228/);
  return /Pilote : (\d{6})/.exec(sent.text)?.[1] as string;
}

describe("sign-up by USSD (D106)", () => {
  it("opens her account in two calls, with her name shown for her to confirm", async () => {
    const code = await codeSent();
    // Second call: the code, then her name from ANID, her first name, her PIN.
    expect((await call(ENYONAM, "", "call-2")).text).toBe("CON Tapez le code reçu de l'ANID par SMS :\n0. Recommencer");
    const shown = await call(ENYONAM, code, "call-2");
    expect(shown.text).toBe("CON Identité vérifiée :\nENYONAM AFIWA ATTISSO\nEst-ce bien vous ?\n1. Oui\n2. Non");
    expect((await call(ENYONAM, `${code}*1`, "call-2")).text).toMatch(/^CON Le prénom que votre groupe verra/);
    expect((await call(ENYONAM, `${code}*1*Enyonam`, "call-2")).text).toMatch(/^CON Choisissez un code PIN/);
    expect((await call(ENYONAM, `${code}*1*Enyonam*4829`, "call-2")).text).toBe("CON Retapez votre code PIN :");
    const done = await call(ENYONAM, `${code}*1*Enyonam*4829*4829`, "call-2");
    expect(done.text).toMatch(/^END Votre compte Novi est ouvert/);

    const user = await prisma.user.findUniqueOrThrow({ where: { phone: ENYONAM }, include: { consents: true } });
    expect(user).toMatchObject({ legalName: "ENYONAM AFIWA ATTISSO", displayName: "Enyonam", language: "FR" });
    expect(user.consents.map((c) => c.type).sort()).toEqual(["CREDIT_DATA_USE", "ID_CHECK", "TERMS"]);
    expect(await prisma.ussdSignup.count()).toBe(0);
    // She can now use Novi by USSD with her PIN.
    expect((await call(ENYONAM, "4829", "call-3")).text).toMatch(/^CON Novi\n1\. Payer ma cotisation/);
  });

  it("keeps her place if the call drops after the code: the next call starts at her name", async () => {
    const code = await codeSent();
    await call(ENYONAM, code, "call-2"); // the line drops here
    expect((await call(ENYONAM, "", "call-3")).text).toMatch(/^CON Identité vérifiée :\nENYONAM AFIWA ATTISSO/);
    expect((await call(ENYONAM, "1*Enyonam*4829*4829", "call-3")).text).toMatch(/^END Votre compte Novi est ouvert/);
  });

  it("saves nothing when the name shown is not hers", async () => {
    const code = await codeSent();
    expect((await call(ENYONAM, `${code}*2`, "call-2")).text).toMatch(/^END Merci\. Rien n'est enregistré/);
    expect(await prisma.user.count({ where: { phone: ENYONAM } })).toBe(0);
    expect(await prisma.ussdSignup.count()).toBe(0);
  });

  it("refuses details that do not match ANID, and blocks the NIU after three tries", async () => {
    for (let i = 0; i < 2; i += 1) {
      expect((await call(ENYONAM, "1*1*00000000009*01011990", `c${i}`)).text).toMatch(/^END Ces informations ne correspondent pas/);
    }
    expect((await call(ENYONAM, "1*1*00000000009*01011990", "c3")).text).toMatch(/^END Trop d'essais pour ce NIU/);
  });

  it("checks what she types on the keypad: NIU length, date, easy PIN, PINs that differ", async () => {
    expect((await call(ENYONAM, "1*1*123", "a")).text).toMatch(/^END Le NIU a 11 chiffres/);
    expect((await call(ENYONAM, "1*1*00000000009*31021990", "b")).text).toMatch(/^END Date non reconnue/);
    const code = await codeSent();
    expect((await call(ENYONAM, `${code}*1*Enyonam*1234`, "call-2")).text).toMatch(/^END Ce PIN est trop facile/);
    expect((await call(ENYONAM, "1*Enyonam*4829*4830", "call-3")).text).toMatch(/^END Les deux PIN sont différents/);
    expect((await call(ENYONAM, "1*E", "call-4")).text).toMatch(/^END Tapez un prénom de 2 à 30 lettres/);
  });

  it("tells her when this identity already has an account", async () => {
    const enyonam = { niu: "0000-000-0009", legalName: "Enyonam Afiwa Attisso", dateOfBirth: "1983-12-15" };
    await signedUpMember("+22891000009", undefined, enyonam, "Enyonam");
    const code = await codeSent();
    expect((await call(ENYONAM, code, "call-2")).text).toMatch(/^END Cette identité a déjà un compte Novi/);
  });

  it("speaks English when she chooses it", async () => {
    expect((await call(ENYONAM, "2", "e")).text).toMatch(/^CON To open your account/);
  });

  it("keeps every sign-up screen within 160 characters", async () => {
    const code = await codeSent();
    for (const typed of ["", code, `${code}*1`, `${code}*1*Enyonam`, `${code}*1*Enyonam*4829`]) {
      expect(screen(await call(ENYONAM, typed, "call-2")).length).toBeLessThanOrEqual(160);
    }
  });
});

describe("menu 4, what waits for her answer (D106)", () => {
  it("names the USSD code in the invitation SMS, so any phone can answer", () => {
    const invite = { organiserName: "Akossiwa", groupName: "Pagnes Assigamé", amountFcfa: 5000, frequency: "WEEKLY" as const };
    expect(inviteSms("FR", invite)).toContain("Ouvrez ou installez Novi pour répondre.");
    vi.stubEnv("USSD_CODE", "*384*123#");
    expect(inviteSms("FR", invite)).toContain("composez *384*123# depuis tout téléphone (menu 4)");
  });

  async function invited() {
    const akossiwa = as((await signedUpMember()).tokens.accessToken);
    await signedUpMember("+22890000002", undefined, ABLA, "Abla");
    const groupId = (await akossiwa.post("/v1/groups", SMALL_GROUP)).body.id as string;
    await akossiwa.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
    await akossiwa.post(`/v1/groups/${groupId}/propose`);
    return { groupId, akossiwa };
  }

  it("shows the count in the menu, then the invitation with its rules", async () => {
    await invited();
    expect((await dial("+22890000002", "4829")).text).toContain("4. À répondre (1)");
    expect((await dial("+22890000002", "4829*4")).text).toBe("CON À répondre :\n1. Invitation : Pagnes Assigamé");
    const detail = await dial("+22890000002", "4829*4*1");
    expect(detail.text).toContain("« Pagnes Assigamé »\n5 000 F par semaine, 3 membres");
    expect(screen(detail).length).toBeLessThanOrEqual(160);
  });

  it("accepts it, with sharing her record as her own choice (D98)", async () => {
    const { groupId } = await invited();
    expect((await dial("+22890000002", "4829*4*1*1")).text).toMatch(/^CON Pendant qu'elle vérifie le groupe/);
    expect((await dial("+22890000002", "4829*4*1*1*2")).text).toMatch(/^END C'est noté : vous avez accepté/);
    const abla = await prisma.user.findUniqueOrThrow({ where: { phone: "+22890000002" } });
    const seat = await prisma.membership.findUniqueOrThrow({ where: { groupId_userId: { groupId, userId: abla.id } } });
    expect(seat).toMatchObject({ state: "ACCEPTED", acceptedVersion: 1, shareConsentAt: null });
    expect((await dial("+22890000002", "4829*4")).text).toBe("END Rien n'attend votre réponse.");
  });

  it("declines it", async () => {
    await invited();
    expect((await dial("+22890000002", "4829*4*1*2")).text).toMatch(/^END C'est noté : vous avez refusé/);
  });

  it("asks her again when the organiser changes the rules after her yes", async () => {
    const { groupId, akossiwa } = await invited();
    await dial("+22890000002", "4829*4*1*1*1");
    const { name: _name, ...rules } = SMALL_GROUP;
    const revised = await akossiwa.post(`/v1/groups/${groupId}/rules`, { ...rules, amountFcfa: 6000 });
    expect(revised.status).toBe(200);
    const menu = (await dial("+22890000002", "4829*4")).text;
    expect(menu).toBe("CON À répondre :\n1. Règles changées : Pagnes Assigamé");
    expect((await dial("+22890000002", "4829*4*1")).text).toContain("6 000 F par semaine");
  });
});

describe("menu 5, her data (D106)", () => {
  it("shows her names, shares her record with an MFI, and lists who opened it", async () => {
    await signedUpMember("+22890000002", undefined, ABLA, "Abla");
    await prisma.mfi.upsert({ where: { code: "MAWULI" }, create: { code: "MAWULI", name: "Caisse Mawuli" }, update: {} });
    const data = await dial("+22890000002", "4829*5");
    expect(data.text).toContain("Nom vu par le groupe : Abla");
    expect((await dial("+22890000002", "4829*5*1")).text).toContain("1. Caisse Mawuli");
    const shared = await dial("+22890000002", "4829*5*1*1");
    expect(shared.text).toMatch(/^END Relevé partagé avec Caisse Mawuli jusqu'au/);
    expect((await dial("+22890000002", "4829*5*2")).text).toBe("END Personne n'a encore ouvert votre relevé.");
  });
});
