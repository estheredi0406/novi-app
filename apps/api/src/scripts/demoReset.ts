import { prisma } from "../lib/db.js";
import { countPilotData, resetPilotData } from "../services/pilotReset.js";

// Pilot only (D93): start again from zero groups. Accounts, PINs, officer
// logins and credit conditions are kept.
//
//   npm run demo:reset            shows what would be deleted
//   npm run demo:reset -- --yes   deletes it

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
