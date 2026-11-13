import type { ConsoleGroupDetail, ConsoleRoundPayments, StaffRole } from "@novi/shared";
import { useState } from "react";
import { GroupStatement } from "../Accounts";
import { ApiFailure, api } from "../api";
import { day, fcfa } from "../format";
import type { Text } from "../text";
import { useLoad } from "../useLoad";
import { ValidateGroup } from "../ValidateGroup";

const time = (iso: string) => `${day(iso).slice(0, 5)} ${iso.slice(11, 16)}`;

// One group (board 12, D117): who is where by turn, never by name (D33);
// one round's payments with their references, so an officer can match them
// with the operator's statement; every pot; the group's account at the MFI
// (D113); its history. Names are only in the compliance view, for an
// administrator or a compliance officer, with a reason (D117).
// D84, D98: while the group waits for validation, each member's Novi record.
export function GroupPage({
  t,
  groupId,
  onExpired,
  pilot,
  role,
}: {
  t: Text;
  groupId: string;
  onExpired: () => void;
  pilot: boolean;
  role: StaffRole;
}) {
  const { data, failed, reload } = useLoad(
    () => api<ConsoleGroupDetail>("GET", `/v1/console/groups/${groupId}`),
    onExpired,
  );
  const [note, setNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<ConsoleRoundPayments | null>(null);

  // D82, pilot only: the next round falls due today, for a test or a demo.
  async function demoDue() {
    if (!window.confirm(t.demoDueConfirm)) return;
    try {
      const { round } = await api<{ round: number }>("POST", `/v1/console/groups/${groupId}/demo-due`);
      setNote(t.demoDueDone(round));
      setPicked(null);
      reload();
    } catch (err) {
      const key = err instanceof ApiFailure ? err.code : "default";
      setNote(t.errors[key as keyof typeof t.errors] ?? t.errors.default);
    }
  }

  // D149: one more try for the advances refused at the end of the cycle.
  async function retryBacks() {
    try {
      const { retried } = await api<{ retried: number }>("POST", `/v1/console/groups/${groupId}/returns/retry`);
      setNote(t.backsRetried(retried));
      reload();
    } catch (err) {
      const key = err instanceof ApiFailure ? err.code : "default";
      setNote(t.errors[key as keyof typeof t.errors] ?? t.errors.default);
    }
  }

  async function pickRound(number: number) {
    try {
      setPicked(await api<ConsoleRoundPayments>("GET", `/v1/console/groups/${groupId}/rounds/${number}`));
    } catch {
      setNote(t.errors.default);
    }
  }

  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;

  const round = picked ?? data.shownRound;
  const potsSent = data.roundList.filter((r) => r.payout?.status === "PAID").length;
  const potTag = (s: ConsoleGroupDetail["seats"][number]["pot"]) =>
    s.status === "PAID"
      ? s.receipt === "DISPUTED"
        ? ["red", t.potNotReceived(day(s.date))]
        : ["green", s.receipt === "CONFIRMED" ? t.potReceivedConfirmed(day(s.date)) : t.potReceivedOn(day(s.date))]
      : s.status === "NOT_DUE"
        ? ["blue", t.potComing(day(s.date))]
        : s.status === "HELD"
          ? ["wait", t.status.HELD]
          : s.status === "FAILED"
            ? ["red", t.status.FAILED]
            : ["orange", t.status[s.status]];

  // D149: at the end of the cycle, what came back to her of the advances.
  const backsFailed = data.seats.some((s) => s.advanceBack?.status === "FAILED");
  const backLine = (s: ConsoleGroupDetail["seats"][number]) => {
    const b = s.advanceBack;
    if (!b) return <span className="q-meta">{t.backNone}</span>;
    if (b.status === "PAID") return <span className="q-meta back-paid">{t.backPaid(fcfa(b.amountFcfa))}</span>;
    if (b.status === "FAILED") return <span className="q-meta back-failed">{t.backFailed(fcfa(b.amountFcfa))}</span>;
    return <span className="q-meta">{t.backSending(fcfa(b.amountFcfa))}</span>;
  };

  function exportCsv() {
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      [data!.name, data!.accountRef ?? ""],
      [],
      t.seatsCsvHead,
      ...data!.seats.map((s) => [
        s.turn,
        s.organiser ? t.organiserTag : "",
        s.advanceFcfa,
        `${s.paidOnTime}/${s.roundsDue}`,
        s.owedFcfa,
        s.owedBy ?? "",
        t.status[s.pot.status] ?? s.pot.status,
        s.pot.date,
      ]),
      [],
      t.potsCsvHead,
      ...data!.roundList.map((r) => [
        r.number,
        r.dueDate,
        r.payout?.amountFcfa ?? "",
        r.payout ? (t.status[r.payout.status] ?? r.payout.status) : "",
        r.payout?.mfiRef ?? "",
        r.payout?.receipt ?? "",
      ]),
    ];
    const csv = lines.map((r) => r.map(q).join(";")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    link.download = `novi-${data!.name.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <>
      <div className="group-head-bar">
        <a href="#/groups" className="link back">
          ← {t.groupsNav}
        </a>
        <div className="row-actions">
          <button className="ghost" onClick={exportCsv}>
            {t.exportExcel}
          </button>
          {role === "ADMIN" || role === "COMPLIANCE" ? (
            <a className="ghost" href={`#/groups/${groupId}/compliance`}>
              {t.complianceOpen}
            </a>
          ) : null}
        </div>
      </div>
      <h1 className="group-title">
        {data.health ? (
          <span className={`dot dot-${data.health === "RED" ? "red" : data.health === "AMBER" ? "amber" : "green"}`} aria-hidden="true" />
        ) : null}
        {data.name}
      </h1>
      <p className="muted group-sub">
        {fcfa(data.amountFcfa)} {t.frequency[data.frequency]} · {t.membersShort(data.size)} ·{" "}
        {t.payoutOrder[data.payoutOrder] ?? data.payoutOrder} · {t.account} {data.accountRef ?? "…"}
      </p>
      <p className="group-now">
        {data.state === "ACTIVE" && data.currentRound ? (
          <>
            <span>
              {t.round} <b>{t.roundShort(data.currentRound, data.rounds)}</b>
              {data.nextPotDate
                ? ` · ${data.nextPotDate.slice(0, 10) < new Date().toISOString().slice(0, 10) ? t.nextPotLate(day(data.nextPotDate)) : t.nextPotOn(day(data.nextPotDate))}`
                : ""}
            </span>
          </>
        ) : (
          t.groupState[data.state]
        )}
        {data.watch ? <span className={`tag tag-${data.health === "RED" ? "red" : "wait"}`}>{t.watchLine(data.watch)}</span> : null}
      </p>
      {pilot ? (
        <p className="demo-tool">
          <button className="ghost" onClick={() => void demoDue()}>
            {t.demoDue}
          </button>{" "}
          {note ? <span className="small">{note}</span> : null}
        </p>
      ) : null}

      <section className="kpis four">
        <div>
          <span className="tile-label">{t.colHeld}</span>
          <span className="tile-number">{fcfa(data.balanceFcfa)}</span>
          <span className="tile-hint">{t.todayAdvances(fcfa(data.reserveFcfa))}</span>
        </div>
        <div>
          <span className="tile-label">{t.collected}</span>
          <span className="tile-number">{fcfa(data.collectedFcfa)}</span>
          <span className="tile-hint">{t.todayAdvances(fcfa(data.advancesInFcfa))}</span>
        </div>
        <div>
          <span className="tile-label">{t.sent}</span>
          <span className="tile-number">{fcfa(data.paidOutFcfa)}</span>
          <span className="tile-hint">{t.potsCount(potsSent)}</span>
        </div>
        <div>
          <span className="tile-label">{t.colOnTime}</span>
          <span className="tile-number">{data.onTimePct === null ? "–" : `${data.onTimePct} %`}</span>
          <span className="tile-hint">{data.mfiOnTimePct === null ? "" : t.mfiAverage(data.mfiOnTimePct)}</span>
        </div>
      </section>

      {data.seats.length > 0 ? (
        <section className="queue">
          <div className="queue-head">
            <h2>{t.members}</h2>
            {backsFailed && role !== "COMPLIANCE" ? (
              <button className="primary" onClick={() => void retryBacks()}>
                {t.retryBacks}
              </button>
            ) : null}
          </div>
          {backsFailed ? <p className="error small">{t.backsFailed}</p> : null}
          {note && !pilot ? <p className="small">{note}</p> : null}
          <table className="members groups-table">
            <thead>
              <tr>
                <th>{t.colRound}</th>
                <th className="num">{t.colAdvance}</th>
                <th>{t.colOnTime}</th>
                <th>{t.colCovered}</th>
                <th>{t.colHerPot}</th>
              </tr>
            </thead>
            <tbody>
              {data.seats.map((s) => {
                const [tone, label] = potTag(s.pot);
                return (
                  <tr key={s.turn}>
                    <td>
                      <b>{s.turn}</b>
                      {s.organiser ? ` · ${t.organiserTag}` : ""}
                      {s.left ? <span className="q-meta">{t.seatLeft}</span> : null}
                    </td>
                    <td className="num">
                      {fcfa(s.advanceFcfa)}
                      {data.state === "COMPLETED" ? backLine(s) : null}
                    </td>
                    <td>
                      {s.roundsDue === 0 ? "–" : t.onTimeOf(s.paidOnTime, s.roundsDue)}
                      {s.paid > s.paidOnTime ? <span className="q-meta">{t.lateCount(s.paid - s.paidOnTime)}</span> : null}
                    </td>
                    <td>
                      {s.owedFcfa > 0 ? (
                        <span className="tag tag-wait">{t.owedBy(fcfa(s.owedFcfa), s.owedBy ? day(s.owedBy) : null)}</span>
                      ) : (
                        "–"
                      )}
                      {s.defaulted ? <span className="tag tag-red">{t.inDefault}</span> : null}
                      {s.reported ? <span className="q-meta">{t.reportedOpen}</span> : null}
                    </td>
                    <td>
                      <span className={`tag tag-${tone}`}>{label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      {round ? (
        <section className="queue">
          <div className="queue-head">
            <h2>{t.roundNow(round.number, day(round.dueDate))}</h2>
            {data.roundList.length > 1 ? (
              <label className="small muted">
                <span className="sr-only">{t.pickRound}</span>
                <select value={round.number} onChange={(e) => void pickRound(Number(e.target.value))}>
                  {data.roundList.map((r) => (
                    <option key={r.number} value={r.number}>
                      {t.round} {r.number} · {day(r.dueDate)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {round.payments.length === 0 && round.coveredFcfa.length === 0 ? (
            <p className="muted empty-line">{t.noPaymentYet}</p>
          ) : (
            <table className="members groups-table">
              <thead>
                <tr>
                  <th>{t.colReceivedAt}</th>
                  <th>{t.colOperator}</th>
                  <th className="num">{t.colAmount}</th>
                  <th>{t.colState}</th>
                  <th>{t.colFedapayRef}</th>
                </tr>
              </thead>
              <tbody>
                {round.payments.map((p, i) => (
                  <tr key={i}>
                    <td>{time(p.at)}</td>
                    <td>{p.operator}</td>
                    <td className="num">{fcfa(p.amountFcfa)}</td>
                    <td>
                      <span className={`tag tag-${p.status === "PAID" ? "green" : p.reported ? "red" : p.status === "FAILED" ? "red" : "wait"}`}>
                        {p.status === "PAID" ? t.payPaid : p.reported ? t.payReported : p.status === "FAILED" ? t.payFailed : t.payPending}
                      </span>
                    </td>
                    <td className="ref-cell">{p.providerRef ?? "–"}</td>
                  </tr>
                ))}
                {round.coveredFcfa.map((amount, i) => (
                  <tr key={`c${i}`}>
                    <td>{day(round.dueDate).slice(0, 5)}</td>
                    <td>{t.groupAdvances}</td>
                    <td className="num">{fcfa(amount)}</td>
                    <td>
                      <span className="tag tag-wait">{t.shareCovered}</span>
                    </td>
                    <td className="ref-cell">–</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="pot-line">
            {round.pot ? (
              <>
                <b>{t.potAmount(fcfa(round.pot.amountFcfa))}</b>
                {round.pot.at ? ` · ${round.pot.auto ? t.leftAlone : t.leftByOfficer} ${time(round.pot.at)}` : ""}
                {round.pot.via ? ` · ${round.pot.via === "fedapay" ? "FedaPay" : t.viaMfi}` : ""}
                {round.pot.ref ? ` ${round.pot.ref}` : ""}{" "}
                <span className={`tag tag-${round.pot.status === "PAID" ? (round.pot.receipt === "DISPUTED" ? "red" : "green") : round.pot.status === "FAILED" ? "red" : "wait"}`}>
                  {round.pot.status === "PAID"
                    ? round.pot.receipt === "DISPUTED"
                      ? t.disputed
                      : round.pot.receipt === "CONFIRMED"
                        ? t.potConfirmed
                        : t.status.PAID
                    : t.status[round.pot.status]}
                </span>
              </>
            ) : (
              // Before its pot exists: what it should reach, and how much is in.
              <>{t.potExpected(fcfa(round.expectedFcfa), round.payments.filter((p) => p.status === "PAID").length, data.size)}</>
            )}
          </p>
        </section>
      ) : null}

      {data.roundList.length > 0 ? (
        <section className="queue">
          <div className="queue-head">
            <h2>{t.potsTitle}</h2>
          </div>
          <table className="members groups-table">
            <thead>
              <tr>
                <th>{t.colRound}</th>
                <th>{t.colDue}</th>
                <th className="num">{t.colPot}</th>
                <th>{t.colLeft}</th>
                <th>{t.colRef}</th>
                <th>{t.colReceived}</th>
              </tr>
            </thead>
            <tbody>
              {data.roundList.map((r) => (
                <tr key={r.number} className={r.number === data.currentRound ? "current-row" : ""}>
                  <td>{r.number}</td>
                  <td>{day(r.dueDate).slice(0, 5)}</td>
                  <td className="num">{r.payout ? fcfa(r.payout.amountFcfa) : "–"}</td>
                  <td>
                    {r.payout?.status === "PAID"
                      ? `${r.payout.auto ? t.leftAloneShort : t.leftByOfficerShort} · ${r.payout.via === "fedapay" ? "FedaPay" : t.viaMfi}`
                      : r.payout
                        ? t.status[r.payout.status]
                        : t.payments(r.paymentsReceived, r.paymentsExpected)}
                  </td>
                  <td className="ref-cell">{r.payout?.mfiRef ?? "–"}</td>
                  <td>
                    {r.payout?.status === "PAID" ? (
                      <span className={`tag tag-${r.payout.receipt === "DISPUTED" ? "red" : r.payout.receipt === "CONFIRMED" ? "green" : "wait"}`}>
                        {r.payout.receipt === "DISPUTED" ? t.disputed : r.payout.receipt === "CONFIRMED" ? t.potConfirmed : t.potUnanswered}
                      </span>
                    ) : (
                      <span className="tag tag-blue">{t.potComingShort}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <GroupStatement t={t} groupId={groupId} onExpired={onExpired} />

      {data.history.length > 0 ? (
        <section className="queue">
          <div className="queue-head">
            <h2>{t.historyTitle}</h2>
          </div>
          <ol className="timeline">
            {data.history.map((h, i) => (
              <li key={i}>
                <b>{day(h.at).slice(0, 5)}</b>
                <span>{t.historyEvent(h.event, h.by, h.round)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* D98: records are shown only while the officer decides. */}
      {data.state !== "STARTING" ? null : (
        <>
          {/* D133: she can validate from here too, after reading the records. */}
          <div className="validate-bar">
            <span className="tag tag-blue">{t.tagValidate}</span>
            <ValidateGroup t={t} group={{ id: groupId, name: data.name }} onDone={() => reload()} />
          </div>
          <h2>{t.recordTitle}</h2>
          <p className="muted small">{t.recordHint}</p>
          <table className="members">
            <thead>
              <tr>
                <th>{t.colMember}</th>
                <th>{t.colRecord}</th>
                <th>{t.colCaisse}</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m, i) => (
                <tr key={i}>
                  <td>
                    {m.consent ? (
                      <>
                        <strong>{m.name}</strong>
                        {m.organiser ? (
                          <span className="muted small"> ({t.organiserTag})</span>
                        ) : null}
                        <br />
                        <span className="small paid-text">
                          ✓ {t.verifiedOn(day(m.verifiedAt ?? ""))}
                        </span>
                      </>
                    ) : (
                      <span className="muted">
                        {m.turn ? `${t.turn(m.turn)} · ` : ""}
                        {t.noConsent}
                      </span>
                    )}
                  </td>
                  <td>
                    {!m.consent ? (
                      "…"
                    ) : m.paymentsMade === 0 && m.cyclesCompleted === 0 ? (
                      <span className="muted">{t.newOnNovi}</span>
                    ) : (
                      <>
                        <span className="dots" aria-hidden="true">
                          {Array.from(
                            { length: Math.min(m.paymentsMade, 24) },
                            (_, k) => (
                              <span
                                key={k}
                                className={
                                  k < m.paymentsOnTime
                                    ? "rec-dot rec-dot-ok"
                                    : "rec-dot rec-dot-late"
                                }
                              />
                            ),
                          )}
                        </span>
                        <br />
                        <span className="small">
                          {t.record(
                            m.cyclesCompleted,
                            m.paymentsMade,
                            m.paymentsOnTime,
                          )}
                        </span>
                      </>
                    )}
                  </td>
                  <td>
                    {!m.consent ? (
                      "…"
                    ) : m.owesCaisseFcfa > 0 ? (
                      <strong className="problem-text">
                        {t.owes(fcfa(m.owesCaisseFcfa))}
                      </strong>
                    ) : (
                      t.recordOwesNothing
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

    </>
  );
}
