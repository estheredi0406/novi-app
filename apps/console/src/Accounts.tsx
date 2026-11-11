import type { ConsoleAccounts, ConsoleGroupAccount } from "@novi/shared";
import { useEffect } from "react";
import { api } from "./api";
import { day, fcfa } from "./format";
import type { Text } from "./text";
import { useLoad } from "./useLoad";

const time = (iso: string) => iso.slice(11, 16);

// D113: the money three ways, side by side: Novi's ledger, the MFI's books
// (simulated core banking) and the real FedaPay balance. Refreshed every
// 15 seconds, so a payment made in the app shows up while you watch.
export function MoneyViews({ t, onExpired }: { t: Text; onExpired: () => void }) {
  const { data, reload } = useLoad(() => api<ConsoleAccounts>("GET", "/v1/console/accounts"), onExpired);
  useEffect(() => {
    const timer = setInterval(reload, 15_000);
    return () => clearInterval(timer);
  }, [reload]);
  if (!data) return null;

  const fedapay = data.fedapay?.amountFcfa ?? null;
  const gap = data.noviFcfa - data.bankFcfa;
  return (
    <section className="queue">
      <div className="queue-head">
        <h2>{t.moneyTitle}</h2>
        {data.fedapay?.checkedAt ? <span className="muted small">{t.moneyChecked(time(data.fedapay.checkedAt))}</span> : null}
      </div>
      <div className="kpis money">
        <div>
          <span className="tile-label">{t.moneyNovi}</span>
          <span className="tile-number">{fcfa(data.noviFcfa)}</span>
        </div>
        <div>
          <span className="tile-label">{t.moneyBank}</span>
          <span className="tile-number">{fcfa(data.bankFcfa)}</span>
          <span className="tile-hint">{t.moneyBankHint(data.bankAccounts)}</span>
        </div>
        <div>
          <span className="tile-label">{data.fedapay?.source === "demo" ? t.moneyFedapayDemo : t.moneyFedapay}</span>
          <span className="tile-number">{fedapay === null ? "–" : fcfa(fedapay)}</span>
          {data.inTransitFcfa > 0 ? <span className="tile-hint">{t.moneyInTransit(fcfa(data.inTransitFcfa))}</span> : null}
        </div>
      </div>
      {gap !== 0 ? <p className="warn small money-gap">{t.moneyGap(fcfa(Math.abs(gap)))}</p> : null}
    </section>
  );
}

// D113: one group's account at the MFI, as its banking system would show it.
export function GroupStatement({ t, groupId, onExpired }: { t: Text; groupId: string; onExpired: () => void }) {
  const { data } = useLoad(
    () => api<ConsoleGroupAccount | null>("GET", `/v1/console/groups/${groupId}/account`),
    onExpired,
  );
  if (!data) return null;
  return (
    <section className="queue">
      <div className="queue-head">
        <h2>{t.statementTitle(data.ref)}</h2>
        <span className="muted small">{t.statementBalance(fcfa(data.balanceFcfa))}</span>
      </div>
      <div>
        <table className="members groups-table statement">
          <thead>
            <tr>
              <th>{t.colDate}</th>
              <th>{t.colLabel}</th>
              <th className="num">{t.colAmount}</th>
              <th className="num">{t.colBalanceAfter}</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e, i) => (
              <tr key={i}>
                <td>
                  {day(e.bookedAt)} {time(e.bookedAt)}
                </td>
                <td>{e.label}</td>
                <td className={`num ${e.amountFcfa < 0 ? "" : "paid-text"}`}>
                  {e.amountFcfa > 0 ? "+" : "−"}
                  {fcfa(Math.abs(e.amountFcfa))}
                </td>
                <td className="num">{fcfa(e.balanceAfterFcfa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
