import type {
  ConsoleLoan,
  ConsoleLoanDetail,
  CreditPolicyInput,
  CreditPolicyPreview,
  CreditPolicyView,
  LoanCheck,
  LoanDocumentView,
} from "@novi/shared";
import { useEffect, useState } from "react";
import { ApiFailure, api, apiImage } from "../api";
import { day, fcfa } from "../format";
import type { Text } from "../text";
import { useLoad } from "../useLoad";

// D89, D91: microloan requests from members. The MFI's own conditions are
// checked one by one with her figures. The officer's first answer is a
// preselection (her documents are asked for) or a refusal; he checks each
// photo; once the file is complete she goes to the agency, and the outcome
// (granted or not) is recorded here. Novi neither lends nor moves the money.

function Tabs({ t, on }: { t: Text; on: "requests" | "policy" }) {
  return (
    <div className="subtabs">
      <a href="#/loans" className={on === "requests" ? "on" : ""}>
        {t.loansTabRequests}
      </a>
      <a href="#/loan-policy" className={on === "policy" ? "on" : ""}>
        {t.loansTabPolicy}
      </a>
    </div>
  );
}

const OPEN = ["PENDING", "PRESELECTED"];

export function Loans({ t, onExpired }: { t: Text; onExpired: () => void }) {
  const { data, failed } = useLoad(
    () => api<ConsoleLoan[]>("GET", "/v1/console/loans"),
    onExpired,
  );
  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;
  const open = data.filter((l) => OPEN.includes(l.status));
  const closed = data.filter((l) => !OPEN.includes(l.status));

  const status = (l: ConsoleLoan) =>
    l.status === "PRESELECTED"
      ? l.documentsComplete
        ? t.loanFileComplete
        : l.documentsSent > 0
          ? t.loanDocsToCheck(l.documentsSent)
          : t.loanWaitingDocs
      : l.status === "GRANTED" && l.grantedFcfa
        ? t.loanGranted(fcfa(l.grantedFcfa))
        : t.loanStatus[l.status];

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
      <td className={`status-${l.status.toLowerCase()}`}>{status(l)}</td>
    </tr>
  );

  return (
    <>
      <h1>{t.loansTitle}</h1>
      <Tabs t={t} on="requests" />
      <p className="muted">{t.loansHint}</p>
      <h2>{t.loansPending(open.length)}</h2>
      {open.length === 0 ? (
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
          <tbody>{open.map(row)}</tbody>
        </table>
      )}
      {closed.length > 0 ? (
        <>
          <h2>{t.loansDecided}</h2>
          <table className="members">
            <tbody>{closed.map(row)}</tbody>
          </table>
        </>
      ) : null}
    </>
  );
}

// One condition as a sentence, with her figure.
export function checkLine(t: Text, c: LoanCheck): [string, string] {
  const f = c.figures;
  switch (c.key) {
    case "CYCLE_OR_STREAK":
      return [
        t.condCycle(f.minCycles ?? 0, f.minStreak ?? 0),
        t.condCycleHave(f.cycles ?? 0, f.streak ?? 0),
      ];
    case "ON_TIME":
      return [
        t.condOnTime(f.min ?? 0),
        `${f.percent ?? 0} % (${f.onTime ?? 0} / ${f.made ?? 0})`,
      ];
    case "NO_DEBT":
      return [t.condNoDebt, fcfa(f.owes ?? 0)];
    case "WAIT_AFTER_REFUSAL":
      return [
        t.condWait(f.wait ?? 0),
        (f.days ?? 0) > 0 ? t.condDays(f.days ?? 0) : t.condNoRefusal,
      ];
    case "CEILING":
      return [
        t.condCeiling(f.times ?? 0),
        `${fcfa(f.amount ?? 0)} ≤ ${fcfa(f.ceiling ?? 0)}`,
      ];
    default:
      return [t.condOpen, ""];
  }
}

function DocumentRow({
  t,
  loanId,
  doc,
  canReview,
  onReviewed,
}: {
  t: Text;
  loanId: string;
  doc: LoanDocumentView;
  canReview: boolean;
  onReviewed: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => (src ? URL.revokeObjectURL(src) : undefined), [src]);

  async function open() {
    if (!doc.id) return;
    setSrc(await apiImage(`/v1/console/loans/${loanId}/documents/${doc.id}`));
  }
  async function review(accepted: boolean) {
    let note: string | undefined;
    if (!accepted) {
      note = window.prompt(t.docRedoAsk)?.trim();
      if (!note) return;
    }
    setBusy(true);
    try {
      await api(
        "POST",
        `/v1/console/loans/${loanId}/documents/${doc.id}/review`,
        { accepted, note },
      );
      onReviewed();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="doc-row">
      <div className="doc-text">
        <strong>{doc.label}</strong>
        <span className={`small doc-${doc.status.toLowerCase()}`}>
          {t.docStatus[doc.status]}
          {doc.note ? ` : « ${doc.note} »` : ""}
          {doc.deleted ? ` · ${t.docDeleted}` : ""}
        </span>
      </div>
      {doc.id && !src ? (
        <button className="link" onClick={() => void open()}>
          {t.docOpen}
        </button>
      ) : null}
      {canReview && doc.id && doc.status === "SENT" ? (
        <>
          <button
            className="primary small"
            disabled={busy}
            onClick={() => void review(true)}
          >
            {t.docAccept}
          </button>
          <button
            className="link"
            disabled={busy}
            onClick={() => void review(false)}
          >
            {t.docRedo}
          </button>
        </>
      ) : null}
      {src ? <img className="doc-photo" src={src} alt={doc.label} /> : null}
    </div>
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
  const allOk = data.checks.every((c) => c.ok);

  async function decide(
    action: "preselect" | "decline" | "grant" | "notGranted",
  ) {
    setError(null);
    let body: object = { action };
    if (action === "preselect") {
      if (!window.confirm(t.loanPreselectConfirm(data?.memberName ?? "")))
        return;
      body = { action, ...(note.trim() ? { note: note.trim() } : {}) };
    } else if (action === "grant") {
      if (
        !window.confirm(
          t.loanGrantConfirm(fcfa(grantedFcfa), data?.memberName ?? ""),
        )
      )
        return;
      body = {
        action,
        grantedFcfa,
        ...(note.trim() ? { note: note.trim() } : {}),
      };
    } else {
      const reason = window
        .prompt(action === "decline" ? t.loanDeclineAsk : t.loanNotGrantedAsk)
        ?.trim();
      if (!reason || reason.length < 3) return;
      body = { action, reason };
    }
    setBusy(true);
    try {
      await api("POST", `/v1/console/loans/${loanId}/decide`, body);
      setNote("");
      reload();
    } catch (err) {
      const key = err instanceof ApiFailure ? err.code : "default";
      setError(t.errors[key as keyof typeof t.errors] ?? t.errors.default);
    } finally {
      setBusy(false);
    }
  }

  const accepted = data.documents.filter((d) => d.status === "ACCEPTED").length;
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

          <section className="cond-box">
            <div className="cond-head">
              <h2>{t.condTitle}</h2>
              <span className="muted small">
                {data.policyUpdatedAt
                  ? t.condSetOn(day(data.policyUpdatedAt))
                  : t.condDefaults}{" "}
                ·{" "}
                <a href="#/loan-policy" className="link">
                  {t.condEdit}
                </a>
              </span>
            </div>
            {data.checks.map((c) => {
              const [text, figure] = checkLine(t, c);
              return (
                <div key={c.key} className="cond-row">
                  <span className={c.ok ? "cond-mark ok" : "cond-mark no"}>
                    {c.ok ? "✓" : "✗"}
                  </span>
                  <span className="cond-text">{text}</span>
                  <strong className={c.ok ? "paid-text" : "problem-text"}>
                    {figure}
                  </strong>
                </div>
              );
            })}
            <p className={allOk ? "paid-text strong" : "problem-text strong"}>
              {allOk ? t.condAllMet : t.condNotAll}
            </p>
          </section>

          {data.status !== "PENDING" && data.documents.length > 0 ? (
            <section className="cond-box">
              <div className="cond-head">
                <h2>{t.docTitle}</h2>
                <span className="muted small">
                  {t.docCount(accepted, data.documents.length)}
                </span>
              </div>
              {!data.documentsConsented ? (
                <p className="muted small">{t.docNoConsent}</p>
              ) : null}
              {data.documents.map((d) => (
                <DocumentRow
                  key={d.key}
                  t={t}
                  loanId={loanId}
                  doc={d}
                  canReview={data.status === "PRESELECTED"}
                  onReviewed={reload}
                />
              ))}
              <p className="muted small">{t.docPrivacy}</p>
            </section>
          ) : null}

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
                      {t.groupState[g.state] ?? g.state}
                    </span>
                  </td>
                  <td>{fcfa(g.amountFcfa)}</td>
                  <td>{t.loanPaidLine(g.paid, g.rounds, g.onTime)}</td>
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
                disabled={busy}
                onClick={() => void decide("preselect")}
              >
                {t.loanPreselect}
              </button>
              <button
                className="link"
                disabled={busy}
                onClick={() => void decide("decline")}
              >
                {t.loanDecline}
              </button>
              <span className="muted small">{t.loanPreselectHint}</span>
            </>
          ) : data.status === "PRESELECTED" && !data.documentsComplete ? (
            <>
              <p className="status-pending">
                {t.loanWaitingDocsLong(accepted, data.documents.length)}
              </p>
              <span className="muted small">{t.loanPreselectedHint}</span>
            </>
          ) : data.status === "PRESELECTED" ? (
            <>
              <p className="status-approved">{t.loanFileCompleteLong}</p>
              <span className="small">{t.loanOutcomeTitle}</span>
              <label className="small">
                {t.loanGrantLabel}
                <input
                  value={granted}
                  placeholder={String(data.amountFcfa)}
                  onChange={(e) => setGranted(e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <button
                className="primary"
                disabled={busy || grantedFcfa <= 0}
                onClick={() => void decide("grant")}
              >
                {t.loanGrant}
              </button>
              <button
                className="link"
                disabled={busy}
                onClick={() => void decide("notGranted")}
              >
                {t.loanNotGranted}
              </button>
            </>
          ) : (
            <p className={`status-${data.status.toLowerCase()}`}>
              {data.status === "GRANTED" && data.grantedFcfa
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

// D91: the MFI's own credit conditions. Officers read them; administrators
// change them, with a preview of how many members would qualify.
export function LoanPolicy({
  t,
  onExpired,
  isAdmin,
}: {
  t: Text;
  onExpired: () => void;
  isAdmin: boolean;
}) {
  const { data, failed, reload } = useLoad(
    () => api<CreditPolicyView>("GET", "/v1/console/credit-policy"),
    onExpired,
  );
  const [form, setForm] = useState<CreditPolicyInput | null>(null);
  const [months, setMonths] = useState("");
  const [preview, setPreview] = useState<CreditPolicyPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    const { updatedAt: _u, updatedByName: _n, ...input } = data;
    setForm(input);
    setMonths(input.months.join(", "));
  }, [data]);

  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data || !form) return null;

  const set = (patch: Partial<CreditPolicyInput>) => {
    setForm({ ...form, ...patch });
    setPreview(null);
    setMessage(null);
  };
  const parsedMonths = months
    .split(/[,\s]+/)
    .map((m) => Number(m))
    .filter((m) => Number.isInteger(m) && m > 0);
  const input: CreditPolicyInput = { ...form, months: parsedMonths };

  async function run(save: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      if (save) {
        await api("PUT", "/v1/console/credit-policy", input);
        setMessage(t.policySaved);
        reload();
      }
      setPreview(
        await api<CreditPolicyPreview>(
          "POST",
          "/v1/console/credit-policy/preview",
          input,
        ),
      );
    } catch (err) {
      const key = err instanceof ApiFailure ? err.code : "default";
      setMessage(t.errors[key as keyof typeof t.errors] ?? t.policyInvalid);
    } finally {
      setBusy(false);
    }
  }

  const num = (
    key: keyof CreditPolicyInput,
    label: string,
    hint: string,
    unit: string,
  ) => (
    <div className="policy-row">
      <div>
        <strong>{label}</strong>
        <p className="muted small">{hint}</p>
      </div>
      <input
        type="number"
        disabled={!isAdmin}
        value={form[key] as number}
        onChange={(e) =>
          set({ [key]: Number(e.target.value) } as Partial<CreditPolicyInput>)
        }
      />
      <span className="muted">{unit}</span>
    </div>
  );

  return (
    <>
      <h1>{t.loansTitle}</h1>
      <Tabs t={t} on="policy" />
      <div className="loan-grid">
        <section className="cond-box">
          <h2>{t.policyTitle}</h2>
          <p className="muted">{t.policyHint}</p>
          <div className="policy-row">
            <div>
              <strong>{t.policyEnabled}</strong>
              <p className="muted small">{t.policyEnabledHint}</p>
            </div>
            <input
              type="checkbox"
              disabled={!isAdmin}
              checked={form.enabled}
              onChange={(e) => set({ enabled: e.target.checked })}
            />
            <span />
          </div>
          {num(
            "minCycles",
            t.policyCycles,
            t.policyAtLeast,
            t.policyCyclesUnit,
          )}
          {num(
            "minStreak",
            t.policyStreak,
            t.policyStreakHint,
            t.policyStreakUnit,
          )}
          {num("minOnTimePct", t.policyOnTime, t.policyAtLeast, "%")}
          {num(
            "ceilingTimesPot",
            t.policyCeiling,
            t.policyCeilingHint,
            t.policyCeilingUnit,
          )}
          {num("waitDays", t.policyWait, t.policyWaitHint, t.policyDays)}
          <div className="policy-row">
            <div>
              <strong>{t.policyMonths}</strong>
              <p className="muted small">{t.policyMonthsHint}</p>
            </div>
            <input
              disabled={!isAdmin}
              value={months}
              onChange={(e) => setMonths(e.target.value)}
            />
            <span className="muted">{t.policyMonthsUnit}</span>
          </div>

          <h3>{t.policyDocs}</h3>
          <p className="muted small">{t.policyDocsHint}</p>
          {form.documents.map((d, i) => (
            <div key={d.key} className="policy-doc">
              <input
                disabled={!isAdmin}
                value={d.label}
                onChange={(e) =>
                  set({
                    documents: form.documents.map((x, j) =>
                      j === i ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
              {isAdmin && form.documents.length > 1 ? (
                <button
                  className="link"
                  onClick={() =>
                    set({ documents: form.documents.filter((_, j) => j !== i) })
                  }
                >
                  {t.policyRemove}
                </button>
              ) : null}
            </div>
          ))}
          {isAdmin && form.documents.length < 10 ? (
            <button
              className="link"
              onClick={() =>
                set({
                  documents: [
                    ...form.documents,
                    {
                      key: `DOC_${Date.now().toString(36).toUpperCase()}`,
                      label: "",
                    },
                  ],
                })
              }
            >
              + {t.policyAddDoc}
            </button>
          ) : null}

          <div className="policy-actions">
            {isAdmin ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void run(true)}
              >
                {t.policySave}
              </button>
            ) : null}
            <button
              className="link"
              disabled={busy}
              onClick={() => void run(false)}
            >
              {t.policyPreview}
            </button>
          </div>
          {message ? <p className="small">{message}</p> : null}
          <p className="muted small">
            {isAdmin ? t.policyAdminNote : t.policyReadOnly}
            {data.updatedAt
              ? ` ${t.policyLast(day(data.updatedAt), data.updatedByName ?? "")}`
              : ` ${t.condDefaults}.`}
          </p>
        </section>
        <aside className="loan-side">
          <h3>{t.policyPreviewTitle}</h3>
          {preview ? (
            <>
              <span className="loan-amount">{preview.eligible}</span>
              <span>{t.policyPreviewLine(preview.members)}</span>
            </>
          ) : (
            <span className="muted small">{t.policyPreviewHint}</span>
          )}
          <hr />
          <h3>{t.policyKeepsTitle}</h3>
          <span className="small">{t.policyKeeps}</span>
        </aside>
      </div>
    </>
  );
}
