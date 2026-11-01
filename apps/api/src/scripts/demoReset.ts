import { prisma } from "../lib/db.js";
import { countPilotData, resetPilotData } from "../services/pilotReset.js";

// Pilot only (D93): start testing again from zero groups.
//
//   npm run demo:reset            shows what would be erased
//   npm run demo:reset -- --yes   erases it
//
// Run it from the server's shell (Render › novi-api › Shell). Members keep
// their accounts and PINs, officers keep their logins, FUCEC keeps its credit
// conditions. Everything else (groups, payments, pots, chats, advances, loan
// requests, shared records, the Journal) is gone for good.

async function main() {
  const counts = await countPilotData();
  console.log(
    `Groups ${counts.groups}, payments ${counts.payments}, pots ${counts.pots}, messages ${counts.messages}, loan requests ${counts.loans}, journal lines ${counts.journal}. Members kept: ${counts.members}.`,
  );
  if (!process.argv.includes("--yes")) {
    console.log('Nothing erased. Run again with "-- --yes" to erase all of the above except the members.');
    return;
  }
  await resetPilotData();
  const after = await countPilotData();
  console.log(`Done. Groups ${after.groups}, members ${after.members}.`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
