import { afterEach, describe, expect, it, vi } from "vitest";
import { MockAnidProvider } from "./MockAnidProvider.js";

const akossiwa = { niu: "0000-000-0001", fullName: "Akossiwa Afi Mensah", dateOfBirth: "1984-03-12" };

// Starts a verification that is expected to succeed and returns its ticket and code.
async function startAndReadCode(anid: MockAnidProvider) {
  const started = await anid.startVerification(akossiwa);
  if (started.kind !== "CODE_SENT") throw new Error("expected a code to be sent");
  const code = anid.sentCodes.get(started.transactionId);
  if (code === undefined) throw new Error("expected a stored code");
  return { transactionId: started.transactionId, code };
}

describe("mock ANID identity check", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a code when NIU, name and date of birth match", async () => {
    const result = await new MockAnidProvider().startVerification(akossiwa);
    expect(result.kind).toBe("CODE_SENT");
  });

  it("ignores capitals and extra spaces in the name", async () => {
    const result = await new MockAnidProvider().startVerification({
      ...akossiwa,
      fullName: "  akossiwa   AFI mensah ",
    });
    expect(result.kind).toBe("CODE_SENT");
  });

  it("refuses a different date of birth", async () => {
    const result = await new MockAnidProvider().startVerification({ ...akossiwa, dateOfBirth: "1984-03-13" });
    expect(result.kind).toBe("NO_MATCH");
  });

  it("refuses an unknown NIU", async () => {
    const result = await new MockAnidProvider().startVerification({ ...akossiwa, niu: "0000-000-9999" });
    expect(result.kind).toBe("NO_MATCH");
  });

  it("verifies with the right code", async () => {
    const anid = new MockAnidProvider();
    const { transactionId, code } = await startAndReadCode(anid);
    const result = await anid.confirmVerification(transactionId, code);
    expect(result.kind).toBe("VERIFIED");
  });

  it("closes the verification after 3 wrong codes", async () => {
    const anid = new MockAnidProvider();
    const { transactionId, code } = await startAndReadCode(anid);
    const wrong = code === "000000" ? "111111" : "000000";

    expect(await anid.confirmVerification(transactionId, wrong)).toEqual({ kind: "CODE_INVALID", attemptsLeft: 2 });
    expect(await anid.confirmVerification(transactionId, wrong)).toEqual({ kind: "CODE_INVALID", attemptsLeft: 1 });
    expect(await anid.confirmVerification(transactionId, wrong)).toEqual({ kind: "EXPIRED" });
  });

  it("expires the code after 5 minutes", async () => {
    vi.useFakeTimers();
    const anid = new MockAnidProvider();
    const { transactionId, code } = await startAndReadCode(anid);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const result = await anid.confirmVerification(transactionId, code);
    expect(result.kind).toBe("EXPIRED");
  });
});