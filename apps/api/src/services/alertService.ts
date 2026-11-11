import { prisma } from "../lib/db.js";
import { email } from "../providers/index.js";
import { purgeLoanDocuments } from "./loanService.js";

// D90: the MFI's staff hear about what waits for them without watching the
// console, so a member is never kept waiting because nobody looked.
// - When something arrives (a group to validate, a pot ready to release, a
//   pot a member says she did not receive, a loan request, an advance to
//   send), every active officer and administrator of that MFI gets an email
//   with a link straight to it.
// - Each working morning at 08:00 (Lomé is on GMT all year), one summary of
//   everything still waiting, if anything is.
// - Anything still waiting after 4 working hours (Monday to Friday, 08:00 to
//   17:00) is emailed again to the administrators.
// Members are never emailed. An email never stops what triggered it.

export type AlertKind =
  | "GROUP_TO_VALIDATE"
  | "POT_READY"
  | "POT_DISPUTED"
  | "LOAN_REQUEST"
  | "ADVANCE_TO_SEND"
  | "PAYMENT_REPORTED" // D105: a payment she says left her account
  | "TRANSFER_FAILED"; // D114: a pot refused after its automatic retries

const WORK_START_H = 8;
const WORK_END_H = 17;
export const ESCALATE_AFTER_MIN = 4 * 60;

const consoleUrl = () =>
  (
    process.env.CONSOLE_URL ?? "https://novi-api-w7ri.onrender.com/console/"
  ).replace(/\/?$/, "/");

function linkFor(kind: AlertKind, refId: string, groupId?: string): string {
  if (kind === "LOAN_REQUEST") return `${consoleUrl()}#/loans/${refId}`;
  if (groupId) return `${consoleUrl()}#/groups/${groupId}`;
  return consoleUrl();
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );

function compose(subject: string, lines: string[], link: string) {
  const text = `${lines.join("\n")}\n\nOuvrir dans la console : ${link}\n\nNovi`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#1B1F4B">
${lines.map((l) => `<p style="margin:0 0 10px">${escapeHtml(l)}</p>`).join("\n")}
<p style="margin:18px 0"><a href="${link}" style="background:#F05A1A;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Ouvrir dans la console</a></p>
<p style="margin:0;color:#4B5070;font-size:13px">Novi, pour ${escapeHtml(subject)}</p></div>`;
  return { subject, text, html };
}

async function staffOf(mfiId: string, adminsOnly = false) {
  return prisma.staffUser.findMany({
    where: {
      mfiId,
      deactivatedAt: null,
      ...(adminsOnly ? { role: "ADMIN" } : {}),
    },
    select: { email: true, name: true },
  });
}

async function sendTo(
  mfiId: string,
  adminsOnly: boolean,
  message: ReturnType<typeof compose>,
) {
  const to = await staffOf(mfiId, adminsOnly);
  if (to.length === 0) return;
  await email.send({
    to: to.map((s) => ({ email: s.email, name: s.name })),
    ...message,
  });
}

// Something new waits for the staff: record it (for the escalation) and
// email them now. Called after the change it is about has been saved.
export async function alertStaff(input: {
  mfiId: string;
  kind: AlertKind;
  refId: string;
  groupId?: string;
  subject: string;
  lines: string[];
}): Promise<void> {
  try {
    await prisma.staffAlert.upsert({
      where: { kind_refId: { kind: input.kind, refId: input.refId } },
      create: { mfiId: input.mfiId, kind: input.kind, refId: input.refId },
      update: {},
    });
    await sendTo(
      input.mfiId,
      false,
      compose(
        input.subject,
        input.lines,
        linkFor(input.kind, input.refId, input.groupId),
      ),
    );
  } catch (err) {
    console.error(`Staff alert ${input.kind} not sent:`, err);
  }
}

// Is it still waiting for the staff?
async function stillWaiting(kind: string, refId: string): Promise<boolean> {
  switch (kind) {
    case "GROUP_TO_VALIDATE":
      return (
        (await prisma.group.count({
          where: { id: refId, state: "STARTING" },
        })) > 0
      );
    case "POT_READY":
      return (
        (await prisma.payout.count({ where: { id: refId, status: "READY" } })) >
        0
      );
    case "POT_DISPUTED":
      // A disputed pot stays open until an officer has looked at it in the
      // console: its alert is closed by hand in a later version. For now it
      // is escalated once.
      return true;
    case "LOAN_REQUEST":
      return (
        (await prisma.loanRequest.count({
          where: { id: refId, status: "PENDING" },
        })) > 0
      );
    case "PAYMENT_REPORTED":
      return (
        (await prisma.contribution.count({
          where: { id: refId, reportedAt: { not: null }, escalatedAt: { not: null }, status: { not: "PAID" } },
        })) > 0
      );
    case "TRANSFER_FAILED":
      return (await prisma.payout.count({ where: { id: refId, status: "FAILED" } })) > 0;
    case "ADVANCE_TO_SEND":
      return (
        (await prisma.advance.count({
          where: { id: refId, status: "APPROVED" },
        })) > 0
      );
    default:
      return false;
  }
}

// Working minutes between two moments: Monday to Friday, 08:00 to 17:00 GMT.
export function workingMinutesBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let total = 0;
  const day = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  while (day <= to) {
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      const open = new Date(day.getTime() + WORK_START_H * 3_600_000);
      const close = new Date(day.getTime() + WORK_END_H * 3_600_000);
      const start = from > open ? from : open;
      const end = to < close ? to : close;
      if (end > start) total += (end.getTime() - start.getTime()) / 60_000;
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return Math.floor(total);
}

const LABEL: Record<string, string> = {
  GROUP_TO_VALIDATE: "un groupe à valider",
  POT_READY: "une cagnotte à libérer",
  POT_DISPUTED: "une cagnotte « non reçue » à vérifier",
  LOAN_REQUEST: "une demande de crédit",
  ADVANCE_TO_SEND: "une avance à verser",
  PAYMENT_REPORTED: "un paiement signalé à vérifier",
  TRANSFER_FAILED: "un virement refusé à corriger",
};

// The escalation and the morning summary. Runs every 15 minutes.
export async function runAlerts(now = new Date()): Promise<void> {
  // D91: photos of documents are kept only as long as the file needs them.
  await purgeLoanDocuments(now).catch((err: unknown) => console.error("Document purge failed:", err));

  // 1. Escalation to the administrators.
  const open = await prisma.staffAlert.findMany({
    where: { resolvedAt: null, escalatedAt: null },
  });
  for (const alert of open) {
    if (!(await stillWaiting(alert.kind, alert.refId))) {
      await prisma.staffAlert.update({
        where: { id: alert.id },
        data: { resolvedAt: now },
      });
      continue;
    }
    if (workingMinutesBetween(alert.createdAt, now) < ESCALATE_AFTER_MIN)
      continue;
    const claimed = await prisma.staffAlert.updateMany({
      where: { id: alert.id, escalatedAt: null },
      data: { escalatedAt: now },
    });
    if (claimed.count === 0) continue;
    try {
      await sendTo(
        alert.mfiId,
        true,
        compose(
          `En attente depuis 4 heures : ${LABEL[alert.kind] ?? alert.kind}`,
          [
            `Personne n'a encore traité ${LABEL[alert.kind] ?? "cet élément"} arrivé le ${alert.createdAt.toISOString().slice(0, 16).replace("T", " à ")} (GMT).`,
            "Un membre attend. Pouvez-vous le confier à un agent ?",
          ],
          linkFor(alert.kind as AlertKind, alert.refId),
        ),
      );
    } catch (err) {
      console.error("Escalation email not sent:", err);
    }
  }

  // 2. The morning summary, once per working day and per MFI.
  const weekday = now.getUTCDay();
  if (weekday === 0 || weekday === 6 || now.getUTCHours() < WORK_START_H)
    return;
  const today = now.toISOString().slice(0, 10);
  const mfis = await prisma.mfi.findMany({ select: { id: true, name: true } });
  for (const mfi of mfis) {
    const already = await prisma.auditEvent.count({
      where: {
        type: "STAFF_DIGEST_SENT",
        details: { equals: { mfiId: mfi.id, day: today } },
      },
    });
    if (already > 0) continue;
    await prisma.auditEvent.create({
      data: {
        type: "STAFF_DIGEST_SENT",
        details: { mfiId: mfi.id, day: today },
      },
    });
    const [groups, ready, disputed, loans, advances] = await Promise.all([
      prisma.group.count({ where: { mfiId: mfi.id, state: "STARTING" } }),
      prisma.payout.count({
        where: { status: "READY", round: { group: { mfiId: mfi.id } } },
      }),
      prisma.payout.count({
        where: {
          receiptDisputedAt: { not: null },
          round: { group: { mfiId: mfi.id } },
          updatedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) },
        },
      }),
      prisma.loanRequest.count({ where: { mfiId: mfi.id, status: "PENDING" } }),
      prisma.advance.count({
        where: { status: "APPROVED", group: { mfiId: mfi.id } },
      }),
    ]);
    const lines = [
      groups ? `${groups} groupe(s) à valider` : null,
      ready ? `${ready} cagnotte(s) à libérer` : null,
      disputed ? `${disputed} cagnotte(s) « non reçue » cette semaine` : null,
      loans ? `${loans} demande(s) de crédit` : null,
      advances ? `${advances} avance(s) à verser` : null,
    ].filter((l): l is string => l !== null);
    if (lines.length === 0) continue;
    try {
      await sendTo(
        mfi.id,
        false,
        compose(
          `Novi, ${mfi.name} : ce qui vous attend ce matin`,
          ["Bonjour,", ...lines],
          consoleUrl(),
        ),
      );
    } catch (err) {
      console.error("Morning summary not sent:", err);
    }
  }
}

export function startAlertJob(everyMs = 15 * 60 * 1000): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    runAlerts()
      .catch((err: unknown) => console.error("Alert job failed:", err))
      .finally(() => {
        running = false;
      });
  }, everyMs);
}
