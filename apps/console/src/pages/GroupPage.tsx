import type { ConsoleGroupDetail } from "@novi/shared";
import { useState } from "react";
import { ApiFailure, api } from "../api";
import { day, fcfa } from "../format";
import { Ring } from "../Icon";
import type { Text } from "../text";
import { useLoad } from "../useLoad";

// One group (board K2, D92): the blue band, this round as a ring of how many
// paid (never who, D33), the money, the rounds as a strip, then each member's
// Novi record. The receiver appears as a turn number, never a name (D33).
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

  const current = data.roundList.find((r) => r.number === data.currentRound);
  const shown = current ?? data.roundList.at(-1);
  const status = (r: ConsoleGroupDetail["roundList"][number]) => r.payout?.status ?? "NOT_DUE";

  return (
    <>
      <div className="group-band">
        <a href="#/" className="link back">
          ← {t.back}
        </a>
        <h1>{data.name}</h1>
        <p>
          {fcfa(data.amountFcfa)} {t.perMember} · {t.frequency[data.frequency]} · {data.size}{" "}
          {t.members.toLowerCase()} · {t.account} {data.accountRef ?? "…"}
        </p>
        {pilot ? (
          <p className="demo-tool" style={{ marginTop: 10 }}>
            <button className="ghost" onClick={() => void demoDue()}>
              {t.demoDue}
            </button>{" "}
            {note ? <span className="small">{note}</span> : null}
          </p>
        ) : null}
      </div>

      <div className="group-top">
        <div className="card round-card">
          {shown ? (
            <>
              <div className="ring-big">
                <Ring paid={shown.paymentsReceived} size={shown.paymentsExpected} px={120} stroke={9} />
                <span>
                  <strong>
                    {shown.paymentsReceived}/{shown.paymentsExpected}
                  </strong>
                  {t.paidOfRound}
                </span>
              </div>
              <div>
                <strong>{t.roundNow(shown.number, day(shown.dueDate))}</strong>
                <br />
                {t.potLine(fcfa(shown.payout?.amountFcfa ?? shown.collectedFcfa))}
                <br />
                <span className="muted small">{t.turn(shown.receiverTurn)}</span>
                <br />
                <span className={`tag ${status(shown) === "READY" ? "tag-orange" : status(shown) === "PAID" ? "tag-green" : status(shown) === "NOT_DUE" ? "tag-blue" : "tag-red"}`}>
                  {t.status[status(shown)]}
                </span>
              </div>
            </>
          ) : (
            <p className="muted">{t.groupState[data.state]}</p>
          )}
        </div>
        <div className="card money-card">
          <dl className="money">
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
              <dd>{fcfa(data.balanceFcfa)}</dd>
            </div>
            <div>
              <dt>{t.reserveLabel}</dt>
              <dd>{fcfa(data.reserveFcfa)}</dd>
            </div>
          </dl>
          {data.roundList.length > 0 ? (
            <div className="strip">
              <span className="muted small">{t.roundsTitle}</span>
              <ol>
                {data.roundList.map((r) => {
                  const st = status(r);
                  const cls = st === "PAID" ? "paid" : st.toLowerCase();
                  return (
                    <li
                      key={r.number}
                      className={`${cls} ${r.number === data.currentRound ? "current" : ""}`}
                      title={`${t.round} ${r.number} · ${day(r.dueDate)} · ${t.payments(r.paymentsReceived, r.paymentsExpected)}`}
                    >
                      T{r.number}
                      <span>
                        {st !== "NOT_DUE"
                          ? t.status[st].toLowerCase()
                          : r.number === data.currentRound
                            ? t.stripOpen
                            : t.stripNext}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </div>
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
  );
}
