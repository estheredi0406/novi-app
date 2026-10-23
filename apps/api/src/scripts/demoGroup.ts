import { hashSecret, niuKeyedHash } from "../lib/hashing.js";
import { prisma } from "../lib/db.js";
import { acceptRules, createGroup, inviteToGroup, proposeGroup, startGroup } from "../services/groupService.js";

// Development only: sets up a running group of 3 in one command, so payments
// can be tried on the phone without signing up two more people by hand.
//
//   npm run demo:group -w @novi/api -- +22890123456
//
// The number is the one you signed up with in the app. The script:
//   1. creates Abla and Koffi as test members (PIN 4829), if they do not exist;
//   2. creates "Pagnes Assigamé (démo)": 5 000 FCFA every week, 3 members,
//      due the day after today, with you as organiser;
//   3. invites them, proposes the rules, has them accept, and starts the group.
// Every step goes through the same services the app uses, so the group passes
// the same rules (D26 to D29) and ends up exactly as if it had been set up by hand.

const DEMO_MEMBERS = [
  { phone: "+22899000002", niu: "DEMO-0002", legalName: "Abla Dzifa Agbeko", displayName: "Abla" },
  { phone: "+22899000003", niu: "DEMO-0003", legalName: "Koffi Selom Amegah", displayName: "Koffi" },
];

async function demoMember(member: (typeof DEMO_MEMBERS)[number]) {
  const existing = await prisma.user.findUnique({ where: { phone: member.phone } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      phone: member.phone,
      legalName: member.legalName,
      displayName: member.displayName,
      area: "Bè",
      market: "Assigamé",
      language: "FR",
      pinHash: await hashSecret("4829"),
      niuKeyedHash: niuKeyedHash(member.niu),
      idVerifiedAt: new Date(),
    },
  });
}

// Tomorrow's weekday, counted the Novi way: Monday 1 to Sunday 7. Round 1 is
// then due tomorrow, so it can be paid today and the payout runs tomorrow.
function tomorrowsDueDay(): number {
  const day = new Date(Date.now() + 24 * 60 * 60 * 1000).getUTCDay();
  return day === 0 ? 7 : day;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("demo:group is for development only.");
  const phone = process.argv[2];
  if (!phone || !/^\+228\d{8}$/.test(phone)) {
    throw new Error("Give the number you signed up with, for example: npm run demo:group -w @novi/api -- +22890123456");
  }
  const organiser = await prisma.user.findUnique({ where: { phone } });
  if (!organiser) throw new Error(`No Novi account uses ${phone}. Sign up in the app first.`);

  const others = [];
  for (const member of DEMO_MEMBERS) others.push(await demoMember(member));

  const group = await createGroup(organiser.id, {
    name: "Pagnes Assigamé (démo)",
    amountFcfa: 5000,
    frequency: "WEEKLY",
    dueDay: tomorrowsDueDay(),
    size: 3,
    payoutOrder: "DRAWN",
  });
  for (const member of others) await inviteToGroup(group.id, organiser.id, member.phone);
  await proposeGroup(group.id, organiser.id);
  for (const member of others) await acceptRules(group.id, member.id, 1);
  const started = await startGroup(group.id, organiser.id);

  console.log(`Group "${started.name}" is ${started.state}.`);
  console.log("Pull down on the home screen to see it, then open round 1 to pay.");
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
