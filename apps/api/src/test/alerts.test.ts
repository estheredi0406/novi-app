import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { email } from "../providers/index.js";
import { MockEmailProvider } from "../providers/email/MockEmailProvider.js";
import { runAlerts, workingMinutesBetween } from "../services/alertService.js";
import { createStaff } from "../services/staffService.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

// D90: staff hear about what waits for them, outside the console.

if (!(email instanceof MockEmailProvider))
  throw new Error("Tests require the mock email provider.");
const sent = email.sent;

const SMALL_GROUP = {
  name: "Pagnes Assigamé",
  amountFcfa: 5000,
  frequency: "WEEKLY",
  dueDay: 5,
  size: 3,
  payoutOrder: "DRAWN",
};
const as = (token: string) => ({
  post: (path: string, body?: object) =>
    request(app)
      .post(path)
      .set("Authorization", `Bearer ${token}`)
      .send(body ?? {}),
});

async function staff() {
  await prisma.mfi.upsert({
    where: { code: "MAWULI" },
    create: { code: "MAWULI", name: "Caisse Mawuli" },
    update: {},
  });
  await createStaff({
    mfiCode: "MAWULI",
    email: "agent@mawuli.example",
    name: "Mawuli Adzo",
  });
  await createStaff({
    mfiCode: "MAWULI",
    email: "admin@mawuli.example",
    name: "Kafui Amegah",
    role: "ADMIN",
  });
}

// A group that waits for the officer's validation.
async function groupToValidate() {
  const akossiwa = as((await signedUpMember()).tokens.accessToken);
  const abla = as(
    (await signedUpMember("+22890000002", undefined, ABLA, "Abla")).tokens
      .accessToken,
  );
  const koffi = as(
    (await signedUpMember("+22890000003", undefined, KOFFI, "Koffi")).tokens
      .accessToken,
  );
  const groupId = (await akossiwa.post("/v1/groups", SMALL_GROUP)).body
    .id as string;
  await akossiwa.post(`/v1/groups/${groupId}/invites`, {
    phone: "+22890000002",
  });
  await akossiwa.post(`/v1/groups/${groupId}/invites`, {
    phone: "+22890000003",
  });
  await akossiwa.post(`/v1/groups/${groupId}/propose`, { shareConsent: true });
  await abla.post(`/v1/groups/${groupId}/accept`, {
    version: 1,
    shareConsent: true,
  });
  await koffi.post(`/v1/groups/${groupId}/accept`, {
    version: 1,
    shareConsent: true,
  });
  await akossiwa.post(`/v1/groups/${groupId}/start`);
  return groupId;
}

const escalations = () =>
  sent.filter((m) => m.subject.startsWith("En attente"));
const digests = () => sent.filter((m) => m.subject.includes("ce matin"));

beforeEach(() => {
  sent.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("working hours", () => {
  it("counts Monday to Friday, 08:00 to 17:00 GMT only", () => {
    // Friday 16:00 to Monday 11:00: one hour on Friday, three on Monday.
    expect(
      workingMinutesBetween(
        new Date("2026-11-06T16:00:00Z"),
        new Date("2026-11-09T11:00:00Z"),
      ),
    ).toBe(240);
    // A weekend counts for nothing.
    expect(
      workingMinutesBetween(
        new Date("2026-11-07T09:00:00Z"),
        new Date("2026-11-08T15:00:00Z"),
      ),
    ).toBe(0);
  });
});

describe("staff alerts (D90)", () => {
  it("emails every active officer and admin when a group waits for validation", async () => {
    vi.stubEnv("MFI_GROUP_APPROVAL", "true");
    await staff();
    const groupId = await groupToValidate();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to.map((t) => t.email).sort()).toEqual([
      "admin@mawuli.example",
      "agent@mawuli.example",
    ]);
    expect(sent[0]?.subject).toContain("Pagnes Assigamé");
    expect(sent[0]?.html).toContain(`#/groups/${groupId}`);
  });

  it("escalates to the admins after 4 working hours, once, and not once handled", async () => {
    vi.stubEnv("MFI_GROUP_APPROVAL", "true");
    await staff();
    const groupId = await groupToValidate();
    await prisma.staffAlert.updateMany({
      data: { createdAt: new Date("2026-11-09T08:30:00Z") },
    });
    sent.length = 0;

    await runAlerts(new Date("2026-11-09T11:00:00Z")); // Monday, 2.5 working hours later
    expect(escalations()).toHaveLength(0);

    await runAlerts(new Date("2026-11-09T13:00:00Z")); // 4.5 working hours
    expect(escalations()).toHaveLength(1);
    expect(escalations()[0]?.to.map((t) => t.email)).toEqual([
      "admin@mawuli.example",
    ]);

    await runAlerts(new Date("2026-11-09T15:00:00Z"));
    expect(escalations()).toHaveLength(1);

    // Once the officer has validated it, the alert is closed, not escalated.
    await prisma.group.update({
      where: { id: groupId },
      data: { state: "ACTIVE" },
    });
    await prisma.staffAlert.updateMany({ data: { escalatedAt: null } });
    sent.length = 0;
    await runAlerts(new Date("2026-11-10T13:00:00Z"));
    expect(escalations()).toHaveLength(0);
    expect(
      (await prisma.staffAlert.findFirstOrThrow()).resolvedAt,
    ).not.toBeNull();
  });

  it("sends one morning summary per working day when something waits", async () => {
    vi.stubEnv("MFI_GROUP_APPROVAL", "true");
    await staff();
    await groupToValidate();
    sent.length = 0;
    await runAlerts(new Date("2026-11-09T07:30:00Z")); // before 08:00: nothing yet
    expect(digests()).toHaveLength(0);
    await runAlerts(new Date("2026-11-09T08:05:00Z"));
    await runAlerts(new Date("2026-11-09T08:20:00Z"));
    expect(digests()).toHaveLength(1);
    expect(digests()[0]?.text).toContain("1 groupe(s) à valider");
    sent.length = 0;
    await runAlerts(new Date("2026-11-14T09:00:00Z")); // a Saturday
    expect(digests()).toHaveLength(0);
  });
});
