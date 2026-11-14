import type { ConsoleCompliance } from "@novi/shared";
import { useEffect, useState } from "react";
import { ApiFailure, api } from "../api";
import { day, fcfa } from "../format";
import type { Text } from "../text";

const time = (iso: string) => `${day(iso).slice(0, 5)} ${iso.slice(11, 16)}`;

// Compliance view (D117): members' legal names for an anti-money-laundering
// check. Needs a reason, is logged, and closes after 15 minutes.
export function Compliance({
  t,
  groupId,
  staffName,
}: {
  t: Text;
  groupId: string;
  staffName: string;
}) {
  const [reason, setReason] = useState("");
  const [view, setView] = useState<ConsoleCompliance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!view) return;
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, [view]);

  const left = view ? Math.ceil((new Date(view.closesAt).getTime() - now) / 60_000) : 0;
  useEffect(() => {
    if (view && left <= 0) void close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, view]);

  async function open(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setView(await api<ConsoleCompliance>("POST", `/v1/console/groups/${groupId}/compliance`, { reason: reason.trim() }));
      setNow(Date.now());
    } catch (err) {
      const key = err instanceof ApiFailure ? err.code : "default";
      setError(t.errors[key as keyof typeof t.errors] ?? t.errors.default);
    }
  }

  async function close() {
    setView(null);
    await api("POST", `/v1/console/groups/${groupId}/compliance/close`).catch(() => undefined);
    window.location.hash = `#/groups/${groupId}`;
  }

  return (
    <>
      <a href={`#/groups/${groupId}`} className="link back">
        ← {t.back}
      </a>
      <h1>{t.complianceTitle}</h1>

      {!view ? (
        <form className="card compliance-ask" onSubmit={(e) => void open(e)}>
          <p>{t.complianceWhy}</p>
          <label>
            {t.complianceReason}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.complianceReasonExample}
              minLength={3}
              maxLength={200}
              required
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button className="primary" type="submit" disabled={reason.trim().length < 3}>
            {t.complianceOpenButton}
          </button>
        </form>
      ) : (
        <>
          <section className="compliance-banner">
            <div>
              <b>{t.complianceOpenedBy(staffName, view.openedAt.slice(11, 16), view.reason)}</b>
              <br />
              {t.complianceLogged(Math.max(left, 0))}
            </div>
            <button className="ghost" onClick={() => void close()}>
              {t.complianceClose}
            </button>
          </section>

          <section className="queue">
            <div className="queue-head">
              <h2>{t.members}</h2>
            </div>
            <table className="members groups-table">
              <thead>
                <tr>
                  <th>{t.colRound}</th>
                  <th>{t.colLegalName}</th>
                  <th>{t.colIdentity}</th>
                  <th>{t.colPayingNumber}</th>
                  <th>{t.colChannel}</th>
                  <th>{t.colRecordShare}</th>
                </tr>
              </thead>
              <tbody>
                {view.members.map((m, i) => (
                  <tr key={i}>
                    <td>
                      {m.turn ?? "–"}
                      {m.organiser ? ` · ${t.organiserTag}` : ""}
                    </td>
                    <td>
                      <b>{m.legalName}</b>
                      {m.left ? <span className="q-meta">{t.seatLeft}</span> : null}
                    </td>
                    <td>
                      <span className="tag tag-green">{t.verifiedShort(day(m.identityVerifiedAt))}</span>
                    </td>
                    <td>{m.phone}</td>
                    <td>{m.channel === "APP" ? t.channelApp : "USSD"}</td>
                    <td>{m.recordShared ? t.recordSharedYes : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {view.rounds.map((r) => (
            <section className="queue" key={r.number}>
              <div className="queue-head">
                <h2>{t.roundNow(r.number, day(r.dueDate))}</h2>
              </div>
              <table className="members groups-table">
                <thead>
                  <tr>
                    <th>{t.colReceivedAt}</th>
                    <th>{t.colMember}</th>
                    <th>{t.colOperator}</th>
                    <th className="num">{t.colAmount}</th>
                    <th>{t.colState}</th>
                    <th>{t.colFedapayRef}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.payments.map((p, i) => (
                    <tr key={i}>
                      <td>{time(p.at)}</td>
                      <td>
                        {p.legalName}
                        {p.turn ? <span className="q-meta">{t.turnShort(p.turn)}</span> : null}
                      </td>
                      <td>{p.operator}</td>
                      <td className="num">{fcfa(p.amountFcfa)}</td>
                      <td>
                        <span className={`tag tag-${p.status === "PAID" ? "green" : p.reported || p.status === "FAILED" ? "red" : "wait"}`}>
                          {p.status === "PAID" ? t.payPaid : p.reported ? t.payReported : p.status === "FAILED" ? t.payFailed : t.payPending}
                        </span>
                      </td>
                      <td className="ref-cell">{p.providerRef ?? "–"}</td>
                    </tr>
                  ))}
                  {r.covered.map((c, i) => (
                    <tr key={`c${i}`}>
                      <td>{day(r.dueDate).slice(0, 5)}</td>
                      <td>{c.legalName}</td>
                      <td>{t.groupAdvances}</td>
                      <td className="num">{fcfa(c.amountFcfa)}</td>
                      <td>
                        <span className="tag tag-wait">{t.shareCovered}</span>
                      </td>
                      <td className="ref-cell">–</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}
    </>
  );
}
