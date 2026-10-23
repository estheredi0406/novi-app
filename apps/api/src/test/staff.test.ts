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
