import type { ConsoleSavings, ConsoleSavingsPolicy } from "@novi/shared";
import { Fragment, useEffect, useState } from "react";
import { api, ApiFailure } from "../api";
import { day, fcfa } from "../format";
import type { Text } from "../text";
import { useLoad } from "../useLoad";

// D123, canvas board 48: members' savings at the MFI. D147: first, the
// caisse's conditions (rates, fees, minimum, early-withdrawal rule), which
// members read before they place anything; until they are complete the caisse
// cannot validate a group and Novi offers no savings. Then the accounts
// members asked for, the open accounts and the withdrawals.
const pct = (bp: number | null) => (bp === null ? "" : String(bp / 100).replace(".", ","));
const toBp = (s: string) => (s.trim() === "" ? null : Math.round(Number(s.replace(",", ".")) * 100));
const num = (n: number | null) => (n === null ? "" : String(n));
const toFcfa = (s: string) => (s.trim() === "" ? null : Number(s));

type Form = {
  free: string;
  l3: string;
  l6: string;
  l12: string;
  o3: boolean;
  o6: boolean;
  o12: boolean;
  opening: string;
  monthly: string;
  withdrawal: string;
  min: string;
  early: "LOSE_GAINS" | "PENALTY" | null;
  penalty: string;
  require: boolean;
};
const emptyForm: Form = {
  free: "",
  l3: "",
  l6: "",
  l12: "",
  o3: true,
  o6: true,
  o12: true,
  opening: "",
  monthly: "",
  withdrawal: "",
  min: "",
  early: null,
  penalty: "",
  require: true,
};

function bodyOf(f: Form): Omit<ConsoleSavingsPolicy, "complete"> {
  const anyLock = f.o3 || f.o6 || f.o12;
  return {
    freeBp: toBp(f.free),
    lock3Bp: f.o3 ? toBp(f.l3) : null,
    lock6Bp: f.o6 ? toBp(f.l6) : null,
    lock12Bp: f.o12 ? toBp(f.l12) : null,
    requireForLoan: f.require,
    openingFeeFcfa: toFcfa(f.opening),
    monthlyFeeFcfa: toFcfa(f.monthly),
    withdrawalFeeFcfa: toFcfa(f.withdrawal),
    minKeepFcfa: toFcfa(f.min),
    earlyRule: anyLock ? f.early : null,
    earlyPenaltyBp: anyLock && f.early === "PENALTY" ? toBp(f.penalty) : null,
  };
}

// What is still empty, named as on the form.
function missingOf(f: Form, t: Text): string[] {
  const out: string[] = [];
  if (!f.o3 && !f.o6 && !f.o12) out.push(t.termsOneDuration);
  for (const [on, v, m] of [
    [f.o3, f.l3, 3],
    [f.o6, f.l6, 6],
    [f.o12, f.l12, 12],
  ] as const)
    if (on && v.trim() === "") out.push(t.savingsRateLock(m));
  if (f.opening === "") out.push(t.termsOpening);
  if (f.monthly === "") out.push(t.termsMonthly);
  if (f.withdrawal === "") out.push(t.termsWithdrawal);
  if (f.min === "") out.push(t.termsMin);
  if ((f.o3 || f.o6 || f.o12) && (f.early === null || (f.early === "PENALTY" && f.penalty.trim() === "")))
    out.push(t.termsEarly);
  return out;
}

function Pct({
  value,
  onChange,
  disabled,
  t,
  unit,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  t: Text;
  unit?: string;
}) {
  return (
    <span className="money-input pct">
      <input
        inputMode="decimal"
        disabled={disabled}
        value={value}
        placeholder="–"
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, ""))}
      />
      <em>{unit ?? t.savingsPerYear}</em>
    </span>
  );
}

export function Savings({ t, onExpired, isAdmin }: { t: Text; onExpired: () => void; isAdmin: boolean }) {
  const { data, failed, reload } = useLoad(() => api<ConsoleSavings>("GET", "/v1/console/savings"), onExpired);
  const [refusing, setRefusing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);

  useEffect(() => {
    if (!data) return;
    const p = data.policy;
    setForm({
      free: pct(p.freeBp),
      l3: pct(p.lock3Bp),
      l6: pct(p.lock6Bp),
      l12: pct(p.lock12Bp),
      // A duration is offered once it has a rate; a new caisse starts with all three.
      o3: p.lock3Bp !== null || !p.complete,
      o6: p.lock6Bp !== null || !p.complete,
      o12: p.lock12Bp !== null || !p.complete,
      opening: num(p.openingFeeFcfa),
      monthly: num(p.monthlyFeeFcfa),
      withdrawal: num(p.withdrawalFeeFcfa),
      min: num(p.minKeepFcfa),
      early: p.earlyRule,
      penalty: pct(p.earlyPenaltyBp),
      require: p.requireForLoan,
    });
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
  const body = bodyOf(form);
  const missing = missingOf(form, t);
  const savePolicy = () => run(() => api("PUT", "/v1/console/savings/policy", body));

  return (
    <>
      <h1>{t.savingsTitle}</h1>
      <p className="muted">{t.savingsLede}</p>

      {/* D147: the conditions come first: nothing works without them. */}
      <section className="queue setting terms">
        <div className="setting-head">
          <h2>{t.termsTitle}</h2>
          <span className={`setting-status ${data.policy.complete ? "is-set" : "is-wait"}`}>
            {data.policy.complete ? t.termsComplete : t.termsToFill}
          </span>
        </div>
        <p className="setting-lede">{t.termsLede}</p>

        <h3 className="terms-sub">{t.termsRates}</h3>
        <div className="terms-grid">
          {(
            [
              ["o3", "l3", 3],
              ["o6", "l6", 6],
              ["o12", "l12", 12],
            ] as const
          ).map(([on, key, months]) => (
            <Fragment key={key}>
              <span className="terms-label">{t.savingsRateLock(months)}</span>
              <label className="check">
                <input
                  type="checkbox"
                  disabled={!isAdmin}
                  checked={form[on]}
                  onChange={(e) => setForm({ ...form, [on]: e.target.checked })}
                />
                {t.termsOffered}
              </label>
              {form[on] ? (
                <Pct value={form[key]} disabled={!isAdmin} onChange={(v) => setForm({ ...form, [key]: v })} t={t} />
              ) : (
                <span className="muted small">{t.termsNotOffered}</span>
              )}
            </Fragment>
          ))}
        </div>

        <h3 className="terms-sub">{t.termsFees}</h3>
        <div className="terms-grid">
          {(
            [
              ["opening", t.termsOpening],
              ["monthly", t.termsMonthly],
              ["withdrawal", t.termsWithdrawal],
              ["min", t.termsMin],
            ] as const
          ).map(([key, label]) => (
            <Fragment key={key}>
              <span className="terms-label">{label}</span>
              <span />
              <span className="money-input">
                <input
                  inputMode="numeric"
                  disabled={!isAdmin}
                  value={form[key]}
                  placeholder="–"
                  onChange={(e) => setForm({ ...form, [key]: e.target.value.replace(/[^0-9]/g, "") })}
                />
                <em>FCFA</em>
              </span>
            </Fragment>
          ))}
        </div>

        <h3 className="terms-sub">{t.termsEarly}</h3>
        <div className="terms-early">
          <label className="check">
            <input
              type="radio"
              name="early"
              disabled={!isAdmin}
              checked={form.early === "LOSE_GAINS"}
              onChange={() => setForm({ ...form, early: "LOSE_GAINS" })}
            />
            {t.termsLoseGains}
          </label>
          <label className="check">
            <input
              type="radio"
              name="early"
              disabled={!isAdmin}
              checked={form.early === "PENALTY"}
              onChange={() => setForm({ ...form, early: "PENALTY" })}
            />
            {t.termsPenalty}
            {form.early === "PENALTY" ? (
              <Pct value={form.penalty} disabled={!isAdmin} onChange={(v) => setForm({ ...form, penalty: v })} t={t} unit="%" />
            ) : null}
          </label>
        </div>

        <div className="setting-foot spread">
          <label className="check">
            <input
              type="checkbox"
              disabled={!isAdmin}
              checked={form.require}
              onChange={(e) => setForm({ ...form, require: e.target.checked })}
            />
            {t.savingsRequireHint}
          </label>
          {isAdmin ? (
            <button className="primary" disabled={busy} onClick={() => void savePolicy()}>
              {t.savingsSave}
            </button>
          ) : (
            <span className="muted small">{t.savingsAdminOnly}</span>
          )}
        </div>
        {missing.length > 0 ? <p className="setting-note">{t.termsMissing(missing.join(", "))}</p> : null}
      </section>

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

      {message ? <p className="error">{message}</p> : null}
    </>
  );
}
