import type { ConsoleSharedRecord } from "@novi/shared";
import { api, apiHtml } from "../api";
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
// One shared record, shown as the ACEV document itself (D65): the same page
// a lender sees by scanning its QR code, which the officer can print or save
// as PDF. Opening it is logged with the officer's name (D54).
export function RecordPage({ t, shareId, onExpired }: { t: Text; shareId: string; onExpired: () => void }) {
  const { data, failed } = useLoad(() => apiHtml(`/v1/console/records/${shareId}/document`), onExpired);

  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;
  return (
    <>
      <a href="#/records" className="link back">
        ← {t.back}
      </a>
      <iframe className="acev-frame" title={t.records} srcDoc={data} />
    </>
  );
}
