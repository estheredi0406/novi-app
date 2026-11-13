import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { PILOT_MFIS } from "../services/groupService.js";
import { createStaff } from "../services/staffService.js";

// Opens a console account for an MFI officer (D52):
//
//   npm run staff:create -w @novi/api -- MAWULI mawuli@mawuli.example "Mawuli Adzo"
//
// It prints a one-time password and the authenticator secret. The officer
// adds the secret to an authenticator app (Google or Microsoft Authenticator:
// "add account", "enter a setup key"), then logs in with email, password and
// the app's 6-digit code. Both are shown only once: run it again with another
// email if they are lost.

async function main() {
  const [mfiCode, email, name, role] = process.argv.slice(2);
  if (!mfiCode || !email || !name) {
    throw new Error('Usage: npm run staff:create -w @novi/api -- MAWULI officer@example.org "Full Name" [ADMIN]');
  }
  // A pilot partner (D120) is created with its first officer if it does not exist yet.
  const pilot = PILOT_MFIS.find((m) => m.code === mfiCode);
  if (pilot) {
    await prisma.mfi.upsert({ where: { code: pilot.code }, create: { ...pilot }, update: {} });
  }
  const created = await createStaff({ mfiCode, email, name, role: role === "ADMIN" ? "ADMIN" : "OFFICER" });

  console.log(`Account created for ${email} at ${mfiCode}.`);
  // Each value alone on its line, so it can be copied without the label.
  console.log("Temporary password (to replace at the first login):");
  console.log(created.password);
  console.log("Authenticator key (Google or Microsoft Authenticator, \"enter a setup key\"):");
  console.log(created.totpSecret);
  console.log(`Or as a link:        ${created.otpauth}`);
  console.log("Keep these somewhere safe now: they are not shown again.");
}

main()
  .catch((err: unknown) => {
    // The same email cannot open two accounts, at any MFI: say so plainly
    // rather than showing the database's own message.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      console.error("This email already has an officer account (at this MFI or another). Use another email.");
      process.exitCode = 1;
      return;
    }
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
