import type { ConsoleSharedRecord, RecordVerification } from "@novi/shared";
import { api } from "../api";
import { day, fcfa } from "../format";
import type { Text } from "../text";
import { useLoad } from "../useLoad";

// Savings records members chose to share with this MFI (D54).
export function Records({ t, onExpired }: { t: Text; onExpired: () => void }) {
  const { data, failed } = useLoad(() => api<ConsoleSharedRecord[]>("GET", "/v1/console/records"), onExpired);

  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;

  return (
    <>
      <h1>{t.records}</h1>
      {data.length === 0 ? (
        <p className="calm">{t.noRecords}</p>
      ) : (
        <ul className="records">
          {data.map((record) => (
            <li key={record.shareId}>
              <a href={`#/records/${record.shareId}`} className="record-row">
                <span className="card-title">{record.legalName}</span>
                <span className="card-meta">
                  {t.sharedOn(day(record.issuedAt))} · {t.until(day(record.expiresAt))} · {t.opened(record.views)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// One record, as the member shared it, checked against Novi's signature.
// Opening it is logged with the officer's name, and she sees it was opened.
export function RecordPage({ t, shareId, onExpired }: { t: Text; shareId: string; onExpired: () => void }) {
  const { data, failed } = useLoad(() => api<RecordVerification>("GET", `/v1/console/records/${shareId}`), onExpired);

  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;
  const r = data.record;

  const facts: [string, string][] = r
    ? [
        [t.facts.memberSince, day(r.memberSince)],
        [t.facts.groups, `${r.groupsJoined} (${r.groupsCompleted})`],
        [t.facts.payments, String(r.paymentsMade)],
        [t.facts.onTime, String(r.paidOnTime)],
        [t.facts.late, String(r.paidLate)],
        [t.facts.missed, String(r.missed)],
        [t.facts.saved, fcfa(r.totalSavedFcfa)],
        [t.facts.received, `${r.potsReceived} · ${fcfa(r.totalReceivedFcfa)}`],
      ]
    : [];

  return (
    <>
      <a href="#/records" className="link back">
        ← {t.back}
      </a>
      <h1>{r?.legalName ?? t.records}</h1>
      <p className={`verdict verdict-${data.status.toLowerCase()}`}>{t.status[data.status]}</p>
      {r && (
        <>
          <dl className="facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <ul className="record-groups">
            {r.groups.map((g) => (
              <li key={g.name + g.mfiName}>
                <strong>{g.name}</strong> · {g.mfiName} · {fcfa(g.amountFcfa)} · {g.paid}/{g.roundsDue} · {g.onTime}{" "}
                {t.facts.onTime.toLowerCase()}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="card-meta">
        {t.sharedOn(day(data.issuedAt))} · {t.until(day(data.expiresAt))} · Ed25519
      </p>
    </>
  );
}
