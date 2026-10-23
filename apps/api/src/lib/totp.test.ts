import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, checkTotp, codeForStep, newTotpSecret, totpStep } from "./totp.js";

// The test secret of RFC 6238, Appendix B: the ASCII text "12345678901234567890".
const RFC_SECRET = Buffer.from("12345678901234567890");
const RFC_SECRET_BASE32 = base32Encode(RFC_SECRET);

describe("authenticator codes (TOTP)", () => {
  it("gives the codes published in RFC 6238 (SHA-1 rows of Appendix B)", () => {
    // The RFC prints 8-digit codes; a 6-digit code is the last 6 digits.
    expect(codeForStep(RFC_SECRET, totpStep(59_000), 8)).toBe("94287082");
    expect(codeForStep(RFC_SECRET, totpStep(1_111_111_109_000), 8)).toBe("07081804");
    expect(codeForStep(RFC_SECRET, totpStep(1_234_567_890_000), 8)).toBe("89005924");
    expect(codeForStep(RFC_SECRET, totpStep(2_000_000_000_000), 8)).toBe("69279037");
    expect(codeForStep(RFC_SECRET, totpStep(59_000))).toBe("287082");
  });

  it("reads back the base32 it writes", () => {
    expect(base32Decode(RFC_SECRET_BASE32)).toEqual(RFC_SECRET);
    expect(RFC_SECRET_BASE32).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("accepts the current code, and the one before or after for a phone clock a little off", () => {
    const now = 1_234_567_890_000;
    const step = totpStep(now);
    expect(checkTotp(RFC_SECRET_BASE32, codeForStep(RFC_SECRET, step), now, null)).toBe(step);
    expect(checkTotp(RFC_SECRET_BASE32, codeForStep(RFC_SECRET, step - 1), now, null)).toBe(step - 1);
    expect(checkTotp(RFC_SECRET_BASE32, codeForStep(RFC_SECRET, step - 2), now, null)).toBeNull();
  });

  it("refuses a code that was already used", () => {
    const now = 1_234_567_890_000;
    const step = totpStep(now);
    expect(checkTotp(RFC_SECRET_BASE32, codeForStep(RFC_SECRET, step), now, step)).toBeNull();
  });

  it("refuses anything that is not 6 digits", () => {
    expect(checkTotp(RFC_SECRET_BASE32, "12345", Date.now(), null)).toBeNull();
    expect(checkTotp(RFC_SECRET_BASE32, "abcdef", Date.now(), null)).toBeNull();
  });

  it("makes a different secret each time", () => {
    expect(newTotpSecret()).not.toBe(newTotpSecret());
    expect(newTotpSecret()).toHaveLength(32);
  });
});
