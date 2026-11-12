import type { ConsoleSavings, ConsoleSavingsPolicy } from "@novi/shared";
import { useEffect, useState } from "react";
import { api, ApiFailure } from "../api";
import { day, fcfa } from "../format";
import type { Text } from "../text";
import { useLoad } from "../useLoad";

// D123, canvas board 48: members' savings at the MFI, placed for 3, 6 or 12
// months (no free savings: one simple product for the MFI). The accounts members
// asked for (open the urgent ones first: the day of their pot is shown; if an
// account is not open that day, the whole pot goes to her phone), the open
// accounts, and the rates the MFI pays, which only an administrator sets.
const pct = (bp: number | null) => (bp === null ? "" : String(bp / 100));
const toBp = (s: string) => (s.trim() === "" ? null : Math.round(Number(s.replace(",", ".")) * 100));

export function Savings({ t, onExpired, isAdmin }: { t: Text; onExpired: () => void; isAdmin: boolean }) {
  const { data, failed, reload } = useLoad(() => api<ConsoleSavings>("GET", "/v1/console/savings"), onExpired);
  const [refusing, setRefusing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [rates, setRates] = useState({ free: "", l3: "", l6: "", l12: "", require: false });

  useEffect(() => {
    if (!data) return;
    const p = data.policy;
    setRates({ free: pct(p.freeBp), l3: pct(p.lock3Bp), l6: pct(p.lock6Bp), l12: pct(p.lock12Bp), require: p.requireForLoan });
  }, [data]);

  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      reload();
    } catch (err) {
      const key = err instanceof ApiFailure ? err.code : "default";
      setMessage(t.errors[key as keyof typeof t.errors] ?? t.errors.default);
    } finally {
      setBusy(false);
    }
  }
  const decide = (id: string, body: { open: true } | { open: false; reason: string }) =>
    run(() => api("POST", `/v1/console/savings/${id}/decide`, body)).then(() => {
      setRefusing(null);
      setReason("");
    });
  const savePolicy = () => {
    const body: ConsoleSavingsPolicy = {
      freeBp: toBp(rates.free),
      lock3Bp: toBp(rates.l3),
      lock6Bp: toBp(rates.l6),
      lock12Bp: toBp(rates.l12),
      requireForLoan: rates.require,
    };
    return run(() => api("PUT", "/v1/console/savings/policy", body));
  };

  return (
    <>
      <h1>{t.savingsTitle}</h1>
      <p className="muted">{t.savingsLede}</p>

      <div className="kpis">
        <div>
          <span className="tile-label">{t.savingsTotal}</span>
          <span className="tile-number">{fcfa(data.totalFcfa)}</span>
          <span className="tile-hint">{t.savingsAccounts(data.openAccounts)}</span>
        </div>
        <div>
          <span className="tile-label">{t.savingsKept}</span>
          <span className="tile-number good">{fcfa(data.keptThisMonthFcfa)}</span>
        </div>
        <div>
          <span className="tile-label">{t.savingsWithdrawn}</span>
          <span className="tile-number">{fcfa(data.withdrawnThisMonthFcfa)}</span>
        </div>
      </div>

      <section className="queue">
        <div className="queue-head">
          <h2>{t.savingsRequests(data.requests.length)}</h2>
        </div>
        {data.requests.length === 0 ? (
          <p className="calm">{t.savingsNoRequests}</p>
        ) : (
          <table className="members groups-table">
            <thead>
              <tr>
                <th>{t.savingsColName}</th>
                <th>{t.savingsColVerified}</th>
                <th>{t.savingsColPot}</th>
                <th>{t.savingsColWish}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.requests.map((r) => (
                <tr key={r.id}>
                  <td className="name-cell">
                    <strong>{r.legalName}</strong>
                    <div className="muted small">{r.ref}</div>
                    {/* D135: the number under the name, so the table fits a laptop. */}
                    <div className="muted small">{r.phone}</div>
                  </td>
                  <td>{t.savingsVerified(day(r.idVerifiedAt))}</td>
                  <td>{r.potDate ? day(r.potDate) : "–"}</td>
                  <td>{r.keepFcfa ? t.savingsWish(fcfa(r.keepFcfa), r.lockMonths ?? 0) : "–"}</td>
                  <td>
                    {refusing === r.id ? (
                      <span className="row">
                        <input
                          value={reason}
                          placeholder={t.savingsReason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <button
                          className="link"
                          disabled={busy || reason.trim().length < 3}
                          onClick={() => void decide(r.id, { open: false, reason: reason.trim() })}
                        >
                          {t.savingsRefuse}
                        </button>
                      </span>
                    ) : (
                      <span className="savings-actions">
                        <button className="primary small" disabled={busy} onClick={() => void decide(r.id, { open: true })}>
                          {t.savingsOpen}
                        </button>
                        <button className="link" disabled={busy} onClick={() => setRefusing(r.id)}>
                          {t.savingsRefuse}
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="queue">
        <div className="queue-head">
          <h2>{t.savingsOpenTitle}</h2>
          <span className="muted small">{t.savingsNamesHidden}</span>
        </div>
        {data.accounts.length === 0 ? (
          <p className="calm">{t.savingsNoAccounts}</p>
        ) : (
          <table className="members groups-table">
            <thead>
              <tr>
                <th>{t.savingsColAccount}</th>
                <th className="num">{t.savingsColBalance}</th>
                <th className="num">{t.savingsColLocked}</th>
                <th className="num">{t.savingsColInterest}</th>
                <th>{t.savingsColLast}</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.ref}</strong>
                  </td>
                  <td className="num">{fcfa(a.totalFcfa)}</td>
                  <td className="num">{fcfa(a.lockedFcfa)}</td>
                  <td className="num">{fcfa(a.interestToDateFcfa)}</td>
                  <td>
                    {a.lastAt && a.lastAmountFcfa !== null
                      ? `${day(a.lastAt)} · ${a.lastKind === "POT_KEPT" ? t.savingsKeptLine : t.savingsWithdrawLine} ${a.lastAmountFcfa > 0 ? "+" : ""}${fcfa(a.lastAmountFcfa)}`
                      : "–"}
                    {a.sending ? <span className="muted small"> · {t.savingsSending}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="queue">
        <div className="queue-head">
          <h2>{t.savingsWithdrawalsTitle}</h2>
          <span className="muted small">{t.savingsWithdrawalsHint}</span>
        </div>
        {data.withdrawals.length === 0 ? (
          <p className="calm">{t.savingsNoWithdrawals}</p>
        ) : (
          <table className="members groups-table">
            <thead>
              <tr>
                <th>{t.savingsColDate}</th>
                <th>{t.savingsColAccount}</th>
                <th className="num">{t.savingsColAmount}</th>
                <th>{t.savingsColStatus}</th>
              </tr>
            </thead>
            <tbody>
              {data.withdrawals.map((w, i) => (
                <tr key={i}>
                  <td>{day(w.at)}</td>
                  <td>
                    <strong>{w.ref}</strong>
                    {w.early ? <div className="muted small">{t.savingsEarly}</div> : null}
                  </td>
                  <td className="num">{fcfa(w.amountFcfa)}</td>
                  <td>{w.status === "DONE" ? t.savingsSent : w.status === "SENDING" ? t.savingsSending : t.savingsFailed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="cond-box">
        <h2>{t.savingsRatesTitle}</h2>
        <p className="muted">{t.savingsRatesHint}</p>
        {(
          [
            ["l3", t.savingsRateLock(3)],
            ["l6", t.savingsRateLock(6)],
            ["l12", t.savingsRateLock(12)],
          ] as const
        ).map(([key, label]) => (
          <div className="policy-row" key={key}>
            <div>
              <strong>{label}</strong>
            </div>
            <input
              type="text"
              inputMode="decimal"
              disabled={!isAdmin}
              value={rates[key]}
              placeholder="–"
              onChange={(e) => setRates({ ...rates, [key]: e.target.value })}
            />
            <span className="muted">{t.savingsPerYear}</span>
          </div>
        ))}
        <div className="policy-row">
          <div>
            <strong>{t.savingsRequire}</strong>
            <p className="muted small">{t.savingsRequireHint}</p>
          </div>
          <input
            type="checkbox"
            disabled={!isAdmin}
            checked={rates.require}
            onChange={(e) => setRates({ ...rates, require: e.target.checked })}
          />
          <span />
        </div>
        {isAdmin ? (
          <button className="primary" disabled={busy} onClick={() => void savePolicy()}>
            {t.savingsSave}
          </button>
        ) : (
          <p className="muted small">{t.savingsAdminOnly}</p>
        )}
      </section>
      {message ? <p className="error">{message}</p> : null}
    </>
  );
}
