import type { ConsoleGroupDetail } from "@novi/shared";
import { useState } from "react";
import { ApiFailure, api } from "../api";
import { day, fcfa } from "../format";
import type { Text } from "../text";
import { useLoad } from "../useLoad";

// One group, round by round. Each round is drawn as a pot that fills as
// payments arrive. The receiver appears as a turn number, never a name (D33).
// D84: above the rounds, each member's Novi record, when she agreed to share it.
export function GroupPage({
  t,
  groupId,
  onExpired,
  pilot,
}: {
  t: Text;
  groupId: string;
  onExpired: () => void;
  pilot: boolean;
}) {
  const { data, failed, reload } = useLoad(
    () => api<ConsoleGroupDetail>("GET", `/v1/console/groups/${groupId}`),
    onExpired,
  );
  const [note, setNote] = useState<string | null>(null);

  // D82, pilot only: the next round falls due today, for a test or a demo.
  async function demoDue() {
    if (!window.confirm(t.demoDueConfirm)) return;
    try {
      const { round } = await api<{ round: number }>(
        "POST",
        `/v1/console/groups/${groupId}/demo-due`,
      );
      setNote(t.demoDueDone(round));
      reload();
    } catch (err) {
      const key = err instanceof ApiFailure ? err.code : "default";
      setNote(t.errors[key as keyof typeof t.errors] ?? t.errors.default);
    }
  }

  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;

  return (
    <>
      <a href="#/" className="link back">
        ← {t.back}
      </a>
      <div className="group-head">
        <div>
          <h1>{data.name}</h1>
          {pilot ? (
            <p className="demo-tool">
              <button className="ghost" onClick={() => void demoDue()}>
                {t.demoDue}
              </button>{" "}
              {note ? <span className="muted small">{note}</span> : null}
            </p>
          ) : null}
          <p className="card-meta">
            {fcfa(data.amountFcfa)} {t.perMember} ·{" "}
            {data.frequency === "WEEKLY" ? t.weekly : t.monthly} · {t.account}{" "}
            {data.accountRef ?? "…"}
          </p>
        </div>
        <dl className="sums">
          <div>
            <dt>{t.collected}</dt>
            <dd>{fcfa(data.collectedFcfa)}</dd>
          </div>
          <div>
            <dt>{t.sent}</dt>
            <dd>{fcfa(data.paidOutFcfa)}</dd>
          </div>
          <div>
            <dt>{t.balance}</dt>
            <dd className="strong">{fcfa(data.balanceFcfa)}</dd>
          </div>
          <div>
            <dt>{t.reserveLabel}</dt>
            <dd>{fcfa(data.reserveFcfa)}</dd>
          </div>
        </dl>
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
                                ? "dot dot-ok"
                                : "dot dot-late"
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

      <div className="pots">
        {data.roundList.map((round) => {
          const fill =
            round.expectedFcfa > 0
              ? round.collectedFcfa / round.expectedFcfa
              : 0;
          const status = round.payout?.status ?? "NOT_DUE";
          const current = round.number === data.currentRound;
          return (
            <div
              key={round.number}
              className={`pot ${current ? "pot-current" : ""}`}
            >
              <div
                className="jar"
                role="img"
                aria-label={`${fcfa(round.collectedFcfa)} / ${fcfa(round.expectedFcfa)}`}
              >
                <div
                  className={`jar-fill jar-${status.toLowerCase()}`}
                  style={{ height: `${Math.round(fill * 100)}%` }}
                />
              </div>
              <strong>
                {t.round} {round.number}
              </strong>
              <span className="pot-line">{day(round.dueDate)}</span>
              <span className="pot-line">
                {t.payments(round.paymentsReceived, round.paymentsExpected)}
              </span>
              <span className={`chip chip-${status.toLowerCase()}`}>
                {t.status[status]}
              </span>
              <span className="pot-line muted">
                {t.turn(round.receiverTurn)}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
