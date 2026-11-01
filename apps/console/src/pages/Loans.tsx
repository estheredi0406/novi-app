import type { ConsoleLoan, ConsoleLoanDetail } from "@novi/shared";
import { useState } from "react";
import { ApiFailure, api } from "../api";
import { day, fcfa } from "../format";
import type { Text } from "../text";
import { useLoad } from "../useLoad";

// D89: microloan requests from members, with their Novi record. The officer
// grants (the same amount or less) or declines with a reason the member reads.
// FUCEC lends and is repaid at its agency; Novi only carries the request.
export function Loans({ t, onExpired }: { t: Text; onExpired: () => void }) {
  const { data, failed } = useLoad(
    () => api<ConsoleLoan[]>("GET", "/v1/console/loans"),
    onExpired,
  );
  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;
  const pending = data.filter((l) => l.status === "PENDING");
  const decided = data.filter((l) => l.status !== "PENDING");

  const row = (l: ConsoleLoan) => (
    <tr key={l.id}>
      <td>
        <a href={`#/loans/${l.id}`} className="flag-title">
          {l.memberName}
        </a>
        <span className="muted small">{l.groupNames.join(", ")}</span>
      </td>
      <td>
        <strong>{fcfa(l.amountFcfa)}</strong>
      </td>
      <td>{t.loanPurpose[l.purpose]}</td>
      <td>{t.loanMonths(l.months)}</td>
      <td className="muted">{day(l.createdAt)}</td>
      <td className={`status-${l.status.toLowerCase()}`}>
        {l.status === "APPROVED" && l.grantedFcfa
          ? t.loanGranted(fcfa(l.grantedFcfa))
          : t.loanStatus[l.status]}
      </td>
    </tr>
  );

  return (
    <>
      <h1>{t.loansTitle}</h1>
      <p className="muted">{t.loansHint}</p>
      <h2>{t.loansPending(pending.length)}</h2>
      {pending.length === 0 ? (
        <p className="calm">{t.loansNone}</p>
      ) : (
        <table className="members">
          <thead>
            <tr>
              <th>{t.colMember}</th>
              <th>{t.loanColAmount}</th>
              <th>{t.loanColPurpose}</th>
              <th>{t.loanColMonths}</th>
              <th>{t.loanColDate}</th>
              <th>{t.loanColStatus}</th>
            </tr>
          </thead>
          <tbody>{pending.map(row)}</tbody>
        </table>
      )}
      {decided.length > 0 ? (
        <>
          <h2>{t.loansDecided}</h2>
          <table className="members">
            <tbody>{decided.map(row)}</tbody>
          </table>
        </>
      ) : null}
    </>
  );
}

export function LoanPage({
  t,
  loanId,
  onExpired,
}: {
  t: Text;
  loanId: string;
  onExpired: () => void;
}) {
  const { data, failed, reload } = useLoad(
    () => api<ConsoleLoanDetail>("GET", `/v1/console/loans/${loanId}`),
    onExpired,
  );
  const [granted, setGranted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;

  const grantedFcfa = Number(
    (granted || String(data.amountFcfa)).replace(/\D/g, ""),
  );

  async function decide(approve: boolean) {
    setError(null);
    let body: object;
    if (approve) {
      if (
        !window.confirm(
          t.loanApproveConfirm(fcfa(grantedFcfa), data?.memberName ?? ""),
        )
      )
        return;
      body = { grantedFcfa, ...(note.trim() ? { note: note.trim() } : {}) };
    } else {
      const reason = window.prompt(t.loanDeclineAsk)?.trim();
      if (!reason || reason.length < 3) return;
      body = { reason };
    }
    setBusy(true);
    try {
      await api(
        "POST",
        `/v1/console/loans/${loanId}/${approve ? "approve" : "decline"}`,
        body,
      );
      reload();
    } catch (err) {
      const key = err instanceof ApiFailure ? err.code : "default";
      setError(t.errors[key as keyof typeof t.errors] ?? t.errors.default);
    } finally {
      setBusy(false);
    }
  }

  const rate =
    data.paymentsMade > 0
      ? Math.round((data.paymentsOnTime / data.paymentsMade) * 100)
      : null;

  return (
    <>
      <a href="#/loans" className="link back">
        ← {t.loansTitle}
      </a>
      <div className="loan-grid">
        <div>
          <h1>{data.memberName}</h1>
          <p className="muted">
            {data.phone} · {data.market ? `${data.market}, ` : ""}
            {data.area} ·{" "}
            <span className="paid-text">
              ✓ {t.verifiedOn(day(data.verifiedAt))}
            </span>
          </p>
          <h2>{t.recordTitleOne}</h2>
          <dl className="sums">
            <div>
              <dt>{t.loanCycles}</dt>
              <dd>{data.cyclesCompleted}</dd>
            </div>
            <div>
              <dt>{t.loanPayments}</dt>
              <dd>{data.paymentsMade}</dd>
            </div>
            <div>
              <dt>{t.loanOnTime}</dt>
              <dd className="strong">{rate === null ? "…" : `${rate} %`}</dd>
            </div>
            <div>
              <dt>{t.colCaisse}</dt>
              <dd>
                {data.owesFcfa > 0
                  ? t.owes(fcfa(data.owesFcfa))
                  : t.recordOwesNothing}
              </dd>
            </div>
          </dl>
          <table className="members">
            <thead>
              <tr>
                <th>{t.colGroup}</th>
                <th>{t.loanColContribution}</th>
                <th>{t.loanColPaid}</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g) => (
                <tr key={g.name}>
                  <td>
                    <strong>{g.name}</strong>
                    <br />
                    <span className="muted small">
                      {t.groupState[g.state as keyof typeof t.groupState] ??
                        g.state}
                    </span>
                  </td>
                  <td>{fcfa(g.amountFcfa)}</td>
                  <td>
                    <span className="dots" aria-hidden="true">
                      {Array.from({ length: Math.min(g.paid, 24) }, (_, k) => (
                        <span
                          key={k}
                          className={
                            k < g.onTime
                              ? "rec-dot rec-dot-ok"
                              : "rec-dot rec-dot-late"
                          }
                        />
                      ))}
                    </span>
                    <br />
                    <span className="small">
                      {t.loanPaidLine(g.paid, g.rounds, g.onTime)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">{t.loanConsentNote}</p>
        </div>

        <aside className="loan-side">
          <span className="muted">{t.loanAsks}</span>
          <span className="loan-amount">{fcfa(data.amountFcfa)}</span>
          <span>
            {t.loanPurpose[data.purpose]} · {t.loanMonths(data.months)}
          </span>
          <span className="muted small">
            {t.loanCeiling(fcfa(data.ceilingFcfa))} ·{" "}
            {t.loanReceived(day(data.createdAt))}
          </span>
          {data.status === "PENDING" ? (
            <>
              <label className="small">
                {t.loanGrantLabel}
                <input
                  value={granted}
                  placeholder={String(data.amountFcfa)}
                  onChange={(e) => setGranted(e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label className="small">
                {t.loanNoteLabel}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={280}
                />
              </label>
              <button
                className="primary"
                disabled={busy || grantedFcfa <= 0}
                onClick={() => void decide(true)}
              >
                {t.loanApprove}
              </button>
              <button
                className="link"
                disabled={busy}
                onClick={() => void decide(false)}
              >
                {t.decline}
              </button>
              <span className="muted small">{t.loanAfter}</span>
            </>
          ) : (
            <p className={`status-${data.status.toLowerCase()}`}>
              {data.status === "APPROVED" && data.grantedFcfa
                ? t.loanGranted(fcfa(data.grantedFcfa))
                : t.loanStatus[data.status]}
              {data.decidedAt ? ` · ${day(data.decidedAt)}` : ""}
              {data.decisionNote ? (
                <>
                  <br />« {data.decisionNote} »
                </>
              ) : null}
            </p>
          )}
          {error ? <p className="error">{error}</p> : null}
        </aside>
      </div>
    </>
  );
}
