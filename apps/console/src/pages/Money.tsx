import type { ConsoleMoney, ConsoleMoneyWhere } from "@novi/shared";
import { useEffect, useState } from "react";
import { api, ApiFailure } from "../api";
import { day, fcfa } from "../format";
import type { Text } from "../text";
import { useLoad } from "../useLoad";

// D124, canvas boards 40 and 42 (simplified): "Comptes". Where the money is,
// what moved today with where each franc is now, and what needs a person.
// FedaPay's own dashboard is one click away: Novi reads the balance, the MFI
// moves money to its bank there.
export const FEDAPAY_DASHBOARD = "https://fedapay.com";
const time = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const TAG: Record<ConsoleMoneyWhere, string> = {
  GROUP_ACCOUNT: "tag tag-green",
  SENT: "tag tag-green",
  WAITING: "tag tag-blue",
  SENDING: "tag tag-blue",
  REPORTED: "tag tag-orange",
  MISMATCH: "tag tag-red",
  FAILED: "tag tag-red",
};

export function Money({ t, onExpired }: { t: Text; onExpired: () => void }) {
  const { data, failed, reload } = useLoad(() => api<ConsoleMoney>("GET", "/v1/console/money"), onExpired);
  const [handling, setHandling] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const timer = setInterval(reload, 15_000);
    return () => clearInterval(timer);
  }, [reload]);

  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;

  const fedapay = data.fedapay?.amountFcfa ?? null;
  async function resolve(id: string) {
    setMessage(null);
    try {
      await api("POST", `/v1/console/money/mismatches/${id}/resolve`, { note: note.trim() });
      setHandling(null);
      setNote("");
      reload();
    } catch (err) {
      const key = err instanceof ApiFailure ? err.code : "default";
      setMessage(t.errors[key as keyof typeof t.errors] ?? t.errors.default);
    }
  }

  return (
    <>
      <div className="row money-head">
        <h1>{t.moneyPageTitle}</h1>
        <a className="button-secondary" href={FEDAPAY_DASHBOARD} target="_blank" rel="noreferrer">
          {t.moneyOpenFedapay}
        </a>
      </div>

      <div className="kpis four">
        <div>
          <span className="tile-label">{data.fedapay?.source === "demo" ? t.moneyFedapayDemo : t.moneyFedapay}</span>
          <span className="tile-number">{fedapay === null ? "–" : fcfa(fedapay)}</span>
          <span className="tile-hint">
            {/* D130: say why there is no figure, instead of a bare dash. */}
            {data.fedapay === null ? t.moneyFedapayNone : fedapay === null ? t.moneyFedapayUnread : t.moneyAtFedapay}
          </span>
        </div>
        <div>
          <span className="tile-label">{t.moneyGroups}</span>
          <span className="tile-number">{fcfa(data.noviFcfa)}</span>
          <span className="tile-hint">{t.moneyBankHint(data.bankAccounts)}</span>
        </div>
        <div>
          <span className="tile-label">{t.moneySavings}</span>
          <span className="tile-number">{fcfa(data.savingsFcfa)}</span>
          <span className="tile-hint">{t.moneySavingsHint}</span>
        </div>
        <div>
          <span className="tile-label">{t.moneyOwed}</span>
          <span className="tile-number">{fcfa(data.owedFcfa)}</span>
          <span className="tile-hint">{t.moneyOwedHint}</span>
        </div>
      </div>

      <section className="queue">
        <div className="queue-head">
          <h2>{data.toCheck.length === 0 ? t.moneyAllMatch : t.moneyToCheck(data.toCheck.length)}</h2>
          {data.noviFcfa !== data.bankFcfa ? (
            <span className="warn small">{t.moneyGap(fcfa(Math.abs(data.noviFcfa - data.bankFcfa)))}</span>
          ) : null}
        </div>
        {data.toCheck.map((c) => (
          <div key={c.contributionId} className="check-card">
            <div className="row">
              <span className="tag tag-red">{t.moneyWrongAmount}</span>
              <span className="muted small">
                {c.groupName} · {t.moneyRound(c.round)} · {day(c.at)} {time(c.at)}
              </span>
            </div>
            <strong>{t.moneyWrongLine(fcfa(c.expectedFcfa), fcfa(c.receivedFcfa))}</strong>
            <p className="muted small">{c.paidNow ? t.moneyPaidSince : t.moneyNothingCredited}</p>
            <p className="muted small">{c.ref ? t.moneyRef(c.ref) : null}</p>
            {handling === c.contributionId ? (
              <div className="row">
                <input value={note} placeholder={t.moneyNotePlaceholder} onChange={(e) => setNote(e.target.value)} />
                <button className="primary small" disabled={note.trim().length < 3} onClick={() => void resolve(c.contributionId)}>
                  {t.moneyMarkHandled}
                </button>
              </div>
            ) : (
              <div className="row">
                <a className="button-secondary" href={FEDAPAY_DASHBOARD} target="_blank" rel="noreferrer">
                  {t.moneySeeFedapay}
                </a>
                <button className="link" onClick={() => setHandling(c.contributionId)}>
                  {t.moneyMarkHandled}
                </button>
              </div>
            )}
          </div>
        ))}
        {message ? <p className="error">{message}</p> : null}
      </section>

      <section className="queue">
        <div className="queue-head">
          <h2>{t.moneyTodayTitle}</h2>
          <span className="muted small">{t.moneyTodayHint}</span>
        </div>
        {data.today.length === 0 ? (
          <p className="calm">{t.moneyNothingToday}</p>
        ) : (
          <table className="members groups-table">
            <thead>
              <tr>
                <th>{t.moneyColTime}</th>
                <th>{t.moneyColWhat}</th>
                <th className="num">{t.moneyColAmount}</th>
                <th>{t.moneyColWhere}</th>
                <th>{t.moneyColRef}</th>
              </tr>
            </thead>
            <tbody>
              {data.today.map((m, i) => (
                <tr key={i}>
                  <td>{time(m.at)}</td>
                  <td>
                    <strong>
                      {m.kind === "CONTRIBUTION"
                        ? t.moneyContribution(m.round ?? 0, m.seat)
                        : m.kind === "PAYOUT"
                          ? t.moneyPot(m.round ?? 0)
                          : t.moneySavingsOut}
                    </strong>
                    <div className="muted small">
                      {m.groupName}
                      {m.keptFcfa ? ` · ${t.moneyKept(fcfa(m.keptFcfa))}` : ""}
                    </div>
                  </td>
                  <td className="num">
                    <strong>
                      {m.amountFcfa > 0 ? "+" : ""}
                      {fcfa(m.amountFcfa)}
                    </strong>
                  </td>
                  <td>
                    <span className={TAG[m.where]}>{t.moneyWhere[m.where]}</span>
                  </td>
                  <td className="muted small">{m.ref ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
