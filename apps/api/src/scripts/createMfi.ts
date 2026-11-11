import { prisma } from "../lib/db.js";

// Adds a partner MFI that groups can choose to keep their money (D95):
//
//   npm run mfi:create -w @novi/api -- DZIDZO "Caisse Dzidzo"
//
// The code is short and stays fixed (it appears in logs and in
// staff:create); the name is what members and officers see. Running it again
// with the same code only changes the name. Then open its first console
// account with staff:create and that code. Never add a real institution
// without an agreement with it: in the pilot, a test MFI says so in its name.

async function main() {
  const [code, name] = process.argv.slice(2);
  if (!code || !name || !/^[A-Z][A-Z0-9_]{1,19}$/.test(code)) {
    throw new Error('Usage: npm run mfi:create -w @novi/api -- DZIDZO "Caisse Dzidzo" (code: capitals, 2 to 20)');
  }
  const mfi = await prisma.mfi.upsert({ where: { code }, create: { code, name }, update: { name } });
  await prisma.auditEvent.create({ data: { type: "MFI_ADDED", details: { mfiId: mfi.id, code, name } } });
  console.log(`${mfi.name} (${mfi.code}) is a partner MFI. Groups can now choose it.`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
