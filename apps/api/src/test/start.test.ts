import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { mfi } from "../providers/index.js";
import { MockMfiAdapter } from "../providers/mfi/MockMfiAdapter.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

if (!(mfi instanceof MockMfiAdapter)) throw new Error("Tests require the mock MFI.");
const mockMfi = mfi;

// A group of 3: Akossiwa, Abla and Koffi, 5 000 FCFA every Friday.
const SMALL_GROUP = {
  name: "Pagnes Assigamé",
  amountFcfa: 5000,
  frequency: "WEEKLY",
  dueDay: 5,
  size: 3,
  payoutOrder: "DRAWN",
};

const ABLA_PHONE = "+22890000002";
const KOFFI_PHONE = "+22890000003";

function as(accessToken: string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  return {
    get: (path: string) => auth(request(app).get(path)),
    post: (path: string, body?: object) => auth(request(app).post(path).send(body ?? {})),
  };
}

type Seat = { memberId: string; displayName: string; payoutPosition: number | null };

// Akossiwa's group with every seat taken: she invites Abla and Koffi,
// proposes the rules, and both accept, unless told who should not answer.
async function fullGroup({ koffiAnswers = true, payoutOrder = "DRAWN" } = {}) {
  const akossiwa = await signedUpMember();
  const abla = await signedUpMember(ABLA_PHONE, undefined, ABLA, "Abla");
  const koffi = await signedUpMember(KOFFI_PHONE, undefined, KOFFI, "Koffi");
  const organiser = as(akossiwa.tokens.accessToken);

  const groupId = (await organiser.post("/v1/groups", { ...SMALL_GROUP, payoutOrder })).body.id as string;
  await organiser.post(`/v1/groups/${groupId}/invites`, { phone: ABLA_PHONE });
  await organiser.post(`/v1/groups/${groupId}/invites`, { phone: KOFFI_PHONE });
  await organiser.post(`/v1/groups/${groupId}/propose`);
  await as(abla.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version: 1 });
  if (koffiAnswers) await as(koffi.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version: 1 });

  return {
    organiser,
    abla: as(abla.tokens.accessToken),
    koffi: as(koffi.tokens.accessToken),
    groupId,
    ids: { akossiwa: akossiwa.member.id, abla: abla.member.id, koffi: koffi.member.id },
  };
}

// The seats in payout order, by name.
function namesInOrder(seats: Seat[]): string[] {
  return [...seats].sort((a, b) => (a.payoutPosition ?? 0) - (b.payoutPosition ?? 0)).map((s) => s.displayName);
}

describe("starting a group", () => {
  it("opens the MFI account and gives every member a turn", async () => {
    const { organiser, groupId } = await fullGroup();
    const res = await organiser.post(`/v1/groups/${groupId}/start`);

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("ACTIVE");
    const positions = res.body.seats.map((s: Seat) => s.payoutPosition).sort();
    expect(positions).toEqual([1, 2, 3]);
    expect(mockMfi.accounts.has(groupId)).toBe(true);
  });

  it("tells the MFI the group totals only, never names or phone numbers (D33)", async () => {
    const { organiser, groupId } = await fullGroup();
    await organiser.post(`/v1/groups/${groupId}/start`);

    expect(mockMfi.accounts.get(groupId)?.request).toEqual({
      groupId,
      contributionFcfa: 5000,
      members: 3,
      frequency: "WEEKLY",
    });
  });

  it("records the drawn order in the audit trail, so it can be shown later how it was set", async () => {
    const { organiser, groupId, ids } = await fullGroup();
    const res = await organiser.post(`/v1/groups/${groupId}/start`);

    const event = await prisma.auditEvent.findFirstOrThrow({ where: { userId: ids.akossiwa, type: "GROUP_STARTING" } });
    const byName = Object.fromEntries(res.body.seats.map((s: Seat) => [s.memberId, s.displayName]));
    const recorded = (event.details as { order: string[] }).order.map((id) => byName[id]);
    expect(recorded).toEqual(namesInOrder(res.body.seats));
  });

  it("refuses to start while someone has not answered", async () => {
    const { organiser, groupId } = await fullGroup({ koffiAnswers: false });
    const res = await organiser.post(`/v1/groups/${groupId}/start`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SEATS_NOT_FILLED");
  });

  it("refuses to start while someone has asked for a change", async () => {
    const { organiser, koffi, groupId } = await fullGroup({ koffiAnswers: false });
    await koffi.post(`/v1/groups/${groupId}/counter`, { version: 1, note: "Samedi plutôt." });

    const res = await organiser.post(`/v1/groups/${groupId}/start`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_EVERYONE_ACCEPTED");
  });

  it("refuses a start by a member who is not the organiser", async () => {
    const { abla, groupId } = await fullGroup();
    const res = await abla.post(`/v1/groups/${groupId}/start`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORGANISER_ONLY");
  });

  it("refuses a third start before she has completed a cycle (D27), and allows it after", async () => {
    const { organiser, groupId, ids } = await fullGroup();
    // Two groups she already started, made directly.
    const mfiRow = await prisma.mfi.findFirstOrThrow();
    for (const name of ["Groupe A", "Groupe B"]) {
      await prisma.group.create({ data: { name, mfiId: mfiRow.id, organiserId: ids.akossiwa, state: "ACTIVE" } });
    }

    const refused = await organiser.post(`/v1/groups/${groupId}/start`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("START_LIMIT_REACHED");

    // She belonged to a group that went all the way round.
    const done = await prisma.group.create({
      data: { name: "Groupe 2025", mfiId: mfiRow.id, organiserId: ids.abla, state: "COMPLETED" },
    });
    await prisma.membership.create({
      data: { groupId: done.id, userId: ids.akossiwa, state: "ACCEPTED", acceptedVersion: 1 },
    });
    expect((await organiser.post(`/v1/groups/${groupId}/start`)).status).toBe(200);
  });

  it("refuses leaving or changing anything once the group has started", async () => {
    const { organiser, abla, groupId } = await fullGroup();
    await organiser.post(`/v1/groups/${groupId}/start`);

    expect((await abla.post(`/v1/groups/${groupId}/decline`)).body.error.code).toBe("NOT_ALLOWED_NOW");
    expect((await organiser.post(`/v1/groups/${groupId}/cancel`)).body.error.code).toBe("NOT_ALLOWED_NOW");
    expect((await organiser.post(`/v1/groups/${groupId}/start`)).body.error.code).toBe("NOT_ALLOWED_NOW");
  });
});

describe("when the MFI does not answer", () => {
  it("keeps the group waiting with its order, and a retry opens one account with the same order", async () => {
    const { organiser, groupId } = await fullGroup();
    mockMfi.failNext = true;

    const failed = await organiser.post(`/v1/groups/${groupId}/start`);
    expect(failed.status).toBe(503);
    expect(failed.body.error.code).toBe("MFI_UNAVAILABLE");

    const waiting = (await organiser.get(`/v1/groups/${groupId}`)).body;
    expect(waiting.state).toBe("STARTING");
    const orderBefore = namesInOrder(waiting.seats);

    const retried = await organiser.post(`/v1/groups/${groupId}/start`);
    expect(retried.status).toBe(200);
    expect(retried.body.state).toBe("ACTIVE");
    expect(namesInOrder(retried.body.seats)).toEqual(orderBefore);
  });

  it("does not let anyone leave while the account is being opened", async () => {
    const { organiser, abla, groupId } = await fullGroup();
    mockMfi.failNext = true;
    await organiser.post(`/v1/groups/${groupId}/start`);

    expect((await abla.post(`/v1/groups/${groupId}/decline`)).body.error.code).toBe("NOT_ALLOWED_NOW");
  });
});

describe("a fixed payout order (D41)", () => {
  it("is set by the organiser as a new version, which everyone accepts before the start", async () => {
    const { organiser, abla, koffi, groupId, ids } = await fullGroup({ payoutOrder: "FIXED" });
    // Abla first: her shop rent is due.
    const order = [ids.abla, ids.akossiwa, ids.koffi];
    const set = await organiser.post(`/v1/groups/${groupId}/order`, { memberIds: order });

    expect(set.status).toBe(200);
    expect(set.body.rules).toMatchObject({ version: 2, payoutOrder: "FIXED", fixedOrder: order });
    expect((await organiser.post(`/v1/groups/${groupId}/start`)).body.error.code).toBe("NOT_EVERYONE_ACCEPTED");

    await abla.post(`/v1/groups/${groupId}/accept`, { version: 2 });
    await koffi.post(`/v1/groups/${groupId}/accept`, { version: 2 });
    const started = await organiser.post(`/v1/groups/${groupId}/start`);
    expect(namesInOrder(started.body.seats)).toEqual(["Abla", "Akossiwa", "Koffi"]);
  });

  it("refuses an order that misses someone or names someone twice", async () => {
    const { organiser, groupId, ids } = await fullGroup({ payoutOrder: "FIXED" });

    const missing = await organiser.post(`/v1/groups/${groupId}/order`, { memberIds: [ids.abla, ids.akossiwa] });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("ORDER_INVALID");
    const twice = await organiser.post(`/v1/groups/${groupId}/order`, { memberIds: [ids.abla, ids.abla, ids.koffi] });
    expect(twice.body.error.code).toBe("ORDER_INVALID");
  });

  it("can be set only once every seat is taken", async () => {
    const { organiser, groupId, ids } = await fullGroup({ koffiAnswers: false, payoutOrder: "FIXED" });
    const res = await organiser.post(`/v1/groups/${groupId}/order`, { memberIds: [ids.abla, ids.akossiwa] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SEATS_NOT_FILLED");
  });

  it("refuses to start a FIXED group whose order has not been set", async () => {
    const { organiser, groupId } = await fullGroup({ payoutOrder: "FIXED" });
    const res = await organiser.post(`/v1/groups/${groupId}/start`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ORDER_INVALID");
  });
});