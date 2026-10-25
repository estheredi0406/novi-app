import { prisma } from "../lib/db.js";
import { runPayouts } from "../services/payoutService.js";

// Demonstration only (D62): treats a group's next round as due today, so a
// payout can be shown during a test or the defence without waiting for the
// due day. A full pot then waits in the console for the officer's release
// (D63), exactly as it would on the real day.
//
//   npm run demo:payout -- "Pagnes Assigamé"
//
// Run it from the server's shell (Render › novi-api › Shell). It goes
// through the same payout service as the every-minute job, so the same
// rules apply: the pot leaves only if every member has paid (otherwise it is
// held), it goes to the member whose turn it is, to her own number, once.

async function main() {
  const name = process.argv.slice(2).join(" ").trim();
  if (!name) throw new Error('Usage: npm run demo:payout -- "Group name"');

  const group = await prisma.group.findFirst({
    where: { state: "ACTIVE", name: { contains: name, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
  });
  if (!group) throw new Error(`No running group whose name contains "${name}".`);

  // The first round whose pot has not reached its member yet.
  const round = await prisma.round.findFirst({
    where: { groupId: group.id, OR: [{ payout: null }, { payout: { status: { not: "PAID" } } }] },
    orderBy: { number: "asc" },
  });
  if (!round) throw new Error(`Every pot of "${group.name}" has already been paid out.`);

  console.log(`${group.name}: round ${round.number}, due ${round.dueDate.toISOString().slice(0, 10)}.`);
  await runPayouts(new Date(round.dueDate.getTime() + 12 * 60 * 60 * 1000), group.id);

  const payout = await prisma.payout.findUnique({ where: { roundId: round.id } });
  console.log(
    payout
      ? `Payout: ${payout.status}, ${payout.amountFcfa} FCFA.${payout.status === "READY" ? " Release it from the MFI console." : ""}`
      : "No payout yet: not every member has paid, so the pot is held.",
  );
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
