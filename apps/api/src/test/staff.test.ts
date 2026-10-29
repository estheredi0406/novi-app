import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { base32Decode, codeForStep, totpStep } from "../lib/totp.js";
import { createStaff } from "../services/staffService.js";
import { signedUpMember } from "./helpers.js";

const EMAIL = "mawuli@fucec.example";

// Mawuli, a FUCEC-Togo loan officer, with his one-time password and the
// secret his authenticator app holds.
async function mawuli() {
  await prisma.mfi.create({ data: { code: "FUCEC", name: "FUCEC-Togo" } });
  const created = await createStaff({ mfiCode: "FUCEC", email: EMAIL, name: "Mawuli Adzo" });
  // What his authenticator app shows at a given moment.
  const codeAt = (timeMs = Date.now()) => codeForStep(base32Decode(created.totpSecret), totpStep(timeMs));
  return { ...created, codeAt };
}

function login(body: object) {
  return request(app).post("/v1/staff/login").send(body);
}

describe("staff login (D52)", () => {
  it("logs an officer in with email, password and authenticator code", async () => {
    const { password, codeAt } = await mawuli();
    const res = await login({ email: EMAIL, password, code: codeAt() });

    expect(res.status).toBe(200);
    expect(res.body.staff).toMatchObject({ name: "Mawuli Adzo", role: "OFFICER", mfi: { code: "FUCEC", name: "FUCEC-Togo" } });
    const me = await request(app).get("/v1/staff/me").set("Authorization", `Bearer ${res.body.accessToken}`);
    expect(me.body.email).toBe(EMAIL);
  });

  it("gives the same answer for a wrong password, a wrong code or an unknown email", async () => {
    const { password, codeAt } = await mawuli();
    const wrongPassword = await login({ email: EMAIL, password: "not-his-password", code: codeAt() });
    const wrongCode = await login({ email: EMAIL, password, code: "000000" });
    const unknown = await login({ email: "nobody@fucec.example", password, code: codeAt() });

    for (const res of [wrongPassword, wrongCode, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("STAFF_LOGIN_FAILED");
    }
  });

  it("accepts each authenticator code only once", async () => {
    const { password, codeAt } = await mawuli();
    const code = codeAt();
    expect((await login({ email: EMAIL, password, code })).status).toBe(200);
    expect((await login({ email: EMAIL, password, code })).body.error.code).toBe("STAFF_LOGIN_FAILED");
  });

  it("locks the account for 15 minutes after 5 failed tries", async () => {
    const { password, codeAt } = await mawuli();
    for (let i = 0; i < 4; i++) await login({ email: EMAIL, password: "wrong-password", code: codeAt() });
    const fifth = await login({ email: EMAIL, password: "wrong-password", code: codeAt() });
    expect(fifth.status).toBe(423);
    expect(fifth.body.error.retryAfterSec).toBe(900);

    // Even the right password and code are refused while locked.
    expect((await login({ email: EMAIL, password, code: codeAt() })).body.error.code).toBe("STAFF_LOCKED");
  });

  it("never lets a member's token into the console, nor a staff token into the member app", async () => {
    const { password, codeAt } = await mawuli();
    const staffToken = (await login({ email: EMAIL, password, code: codeAt() })).body.accessToken as string;
    const member = await signedUpMember();

    const memberInConsole = await request(app).get("/v1/staff/me").set("Authorization", `Bearer ${member.tokens.accessToken}`);
    expect(memberInConsole.status).toBe(401);
    const staffInApp = await request(app).get("/v1/me").set("Authorization", `Bearer ${staffToken}`);
    expect(staffInApp.status).toBe(401);
  });

  it("ends the session at logout", async () => {
    const { password, codeAt } = await mawuli();
    const token = (await login({ email: EMAIL, password, code: codeAt() })).body.accessToken as string;
    const auth = (req: request.Test) => req.set("Authorization", `Bearer ${token}`);

    expect((await auth(request(app).post("/v1/staff/logout"))).status).toBe(204);
    expect((await auth(request(app).get("/v1/staff/me"))).body.error.code).toBe("SESSION_REVOKED");
  });

  it("records logins and failures in the audit trail", async () => {
    const { password, codeAt } = await mawuli();
    await login({ email: EMAIL, password: "wrong-password", code: codeAt() });
    await login({ email: EMAIL, password, code: codeAt() });

    const events = await prisma.auditEvent.findMany({ where: { type: { startsWith: "STAFF_" } }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["STAFF_CREATED", "STAFF_LOGIN_FAILED", "STAFF_LOGIN"]);
  });
});

// D81: the first administrator, logged in, with her own password set.
async function adjo() {
  await prisma.mfi.upsert({ where: { code: "FUCEC" }, create: { code: "FUCEC", name: "FUCEC-Togo" }, update: {} });
  const email = "adjo@fucec.example";
  const created = await createStaff({ mfiCode: "FUCEC", email, name: "Adjo Kpodar", role: "ADMIN" });
  const code = codeForStep(base32Decode(created.totpSecret), totpStep(Date.now()));
  const token = (await login({ email, password: created.password, code })).body.accessToken as string;
  const call = (method: "get" | "post", path: string, body?: object) =>
    request(app)[method](path).set("Authorization", `Bearer ${token}`).send(body);
  await call("post", "/v1/staff/password", { current: created.password, next: "baobab-assigame-2026" });
  return { call, id: created.staffId };
}

describe("first login with a temporary password (D81)", () => {
  it("opens only the password change until she sets her own password", async () => {
    const { password, codeAt } = await mawuli();
    const res = await login({ email: EMAIL, password, code: codeAt() });
    expect(res.body.staff.mustChangePassword).toBe(true);
    const auth = (r: request.Test) => r.set("Authorization", `Bearer ${res.body.accessToken}`);

    expect((await auth(request(app).get("/v1/console/groups"))).body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    const weak = await auth(request(app).post("/v1/staff/password").send({ current: password, next: "short" }));
    expect(weak.body.error.code).toBe("WEAK_PASSWORD");
    const changed = await auth(request(app).post("/v1/staff/password").send({ current: password, next: "kola-et-pagnes-2026" }));
    expect(changed.body.mustChangePassword).toBe(false);
    expect((await auth(request(app).get("/v1/console/groups"))).status).toBe(200);
  });
});

describe("the team (D81)", () => {
  it("lets an administrator add an officer, who logs in with the credentials shown once", async () => {
    const { call } = await adjo();
    const added = await call("post", "/v1/console/team", { name: "Kossi Amegah", email: "Kossi@FUCEC.example", role: "OFFICER" });
    expect(added.status).toBe(201);
    expect(added.body.member).toMatchObject({ name: "Kossi Amegah", email: "kossi@fucec.example", state: "FIRST_LOGIN" });
    expect(added.body.qrSvg).toContain("<svg");
    expect(added.body.password).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);

    const code = codeForStep(base32Decode(added.body.setupKey), totpStep(Date.now()));
    const kossi = await login({ email: "kossi@fucec.example", password: added.body.password, code });
    expect(kossi.status).toBe(200);
    expect(kossi.body.staff).toMatchObject({ role: "OFFICER", mustChangePassword: true });

    const team = (await call("get", "/v1/console/team")).body;
    expect(team.map((m: { name: string }) => m.name)).toEqual(["Adjo Kpodar", "Kossi Amegah"]);
    expect(await prisma.auditEvent.count({ where: { type: "STAFF_ADDED" } })).toBe(1);
  });

  it("is for administrators only, and refuses an email that already has access", async () => {
    const { call } = await adjo();
    await call("post", "/v1/console/team", { name: "Kossi Amegah", email: "kossi@fucec.example", role: "OFFICER" });
    expect((await call("post", "/v1/console/team", { name: "K", email: "kossi@fucec.example", role: "OFFICER" })).status).toBe(400);
    expect(
      (await call("post", "/v1/console/team", { name: "Kossi bis", email: "kossi@fucec.example", role: "OFFICER" })).body.error.code,
    ).toBe("STAFF_EMAIL_TAKEN");

    // An officer (not an administrator) is refused.
    const officer = await createStaff({ mfiCode: "FUCEC", email: EMAIL, name: "Mawuli Adzo" });
    await prisma.staffUser.update({ where: { email: EMAIL }, data: { mustChangePassword: false } });
    const code = codeForStep(base32Decode(officer.totpSecret), totpStep(Date.now()));
    const token = (await login({ email: EMAIL, password: officer.password, code })).body.accessToken;
    const refused = await request(app).get("/v1/console/team").set("Authorization", `Bearer ${token}`);
    expect(refused.body.error.code).toBe("ADMIN_ONLY");
  });

  it("deactivates an officer: logged out at once, and unable to log in", async () => {
    const { call } = await adjo();
    const added = (await call("post", "/v1/console/team", { name: "Kossi Amegah", email: "kossi@fucec.example", role: "OFFICER" })).body;
    const code = codeForStep(base32Decode(added.setupKey), totpStep(Date.now()));
    const token = (await login({ email: "kossi@fucec.example", password: added.password, code })).body.accessToken;

    expect((await call("post", `/v1/console/team/${added.member.id}/deactivate`)).body.state).toBe("DISABLED");
    expect((await request(app).get("/v1/staff/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    const again = await login({ email: "kossi@fucec.example", password: added.password, code: "123456" });
    expect(again.body.error.code).toBe("STAFF_LOGIN_FAILED");

    expect((await call("post", `/v1/console/team/${added.member.id}/reactivate`)).body.state).toBe("FIRST_LOGIN");
  });

  it("never lets the last administrator deactivate herself", async () => {
    const { call, id } = await adjo();
    expect((await call("post", `/v1/console/team/${id}/deactivate`)).status).toBe(409);
  });

  it("resets a lost access: new password and key, the old ones stop working", async () => {
    const { call } = await adjo();
    const added = (await call("post", "/v1/console/team", { name: "Kossi Amegah", email: "kossi@fucec.example", role: "OFFICER" })).body;
    const reset = (await call("post", `/v1/console/team/${added.member.id}/reset`)).body;
    expect(reset.setupKey).not.toBe(added.setupKey);
    const oldCode = codeForStep(base32Decode(added.setupKey), totpStep(Date.now()));
    expect((await login({ email: "kossi@fucec.example", password: added.password, code: oldCode })).status).toBe(401);
    const newCode = codeForStep(base32Decode(reset.setupKey), totpStep(Date.now()));
    expect((await login({ email: "kossi@fucec.example", password: reset.password, code: newCode })).status).toBe(200);
  });

  it("never reaches another MFI's officers", async () => {
    const { call } = await adjo();
    await prisma.mfi.create({ data: { code: "WAGES", name: "WAGES Togo" } });
    const other = await createStaff({ mfiCode: "WAGES", email: "ama@wages.example", name: "Ama" });
    expect((await call("post", `/v1/console/team/${other.staffId}/deactivate`)).status).toBe(404);
  });
});

