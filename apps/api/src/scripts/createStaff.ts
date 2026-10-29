import { prisma } from "../lib/db.js";
import { createStaff } from "../services/staffService.js";

// Opens a console account for an MFI officer (Sprint 5, D52):
//
//   npm run staff:create -w @novi/api -- FUCEC mawuli@fucec.example "Mawuli Adzo"
//
// It prints a one-time password and the authenticator secret. The officer
// adds the secret to an authenticator app (Google or Microsoft Authenticator:
// "add account", "enter a setup key"), then logs in with email, password and
// the app's 6-digit code. Both are shown only once: run it again with another
// email if they are lost.

async function main() {
  const [mfiCode, email, name, role] = process.argv.slice(2);
  if (!mfiCode || !email || !name) {
    throw new Error('Usage: npm run staff:create -w @novi/api -- FUCEC officer@example.org "Full Name" [ADMIN]');
  }
  // The partner MFI exists once a first group is created; make sure it does.
  if (mfiCode === "FUCEC") {
    await prisma.mfi.upsert({ where: { code: "FUCEC" }, create: { code: "FUCEC", name: "FUCEC-Togo" }, update: {} });
  }
  const created = await createStaff({ mfiCode, email, name, role: role === "ADMIN" ? "ADMIN" : "OFFICER" });

  console.log(`Account created for ${email} at ${mfiCode}.`);
  console.log(`Temporary password:  ${created.password}  (to replace at the first login)`);
  console.log(`Authenticator key:   ${created.totpSecret}`);
  console.log(`Or as a link:        ${created.otpauth}`);
  console.log("Keep these somewhere safe now: they are not shown again.");
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
