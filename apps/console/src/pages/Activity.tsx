import type { ConsoleActivity } from "@novi/shared";
import { useState } from "react";
import { api } from "../api";
import { fcfa } from "../format";
import { Icon } from "../Icon";
import type { Text } from "../text";
import { useLoad } from "../useLoad";

type Category = ConsoleActivity["category"];
const CATEGORIES: Category[] = ["MONEY", "GROUPS", "CREDIT", "MEMBERS", "TEAM"];

// Who did what, to which group or member, and when (D67, board K4): every
// validation, release, advance, credit step and opened ACEV by this MFI's
// officers, with filters and a search. The kind of trail an auditor asks for.
export function Activity({ t, onExpired }: { t: Text; onExpired: () => void }) {
  const { data, failed } = useLoad(() => api<ConsoleActivity[]>("GET", "/v1/console/activity"), onExpired);
  const [category, setCategory] = useState<Category | null>(null);
  const [query, setQuery] = useState("");
  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;

  const when = (iso: string) =>
    new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  // The detail column, worded in the console's language: the group or member,
  // the round, the amount, and for a document which one and the verdict.
  const detail = (e: ConsoleActivity) =>
    [
      e.subject,
      e.round !== null ? t.logRound(e.round) : null,
      e.amountFcfa !== null ? fcfa(e.amountFcfa) : null,
      e.action === "STAFF_LOAN_DOCUMENT_VIEWED" && e.detail ? (t.docNames[e.detail] ?? e.detail) : null,
      e.action === "STAFF_LOAN_DOCUMENT_REVIEWED" && e.detail ? (t.docReviewed[e.detail] ?? e.detail) : null,
      e.action === "STAFF_MEMBER_EXIT" && e.detail
        ? ((t.exited as Record<string, string>)[e.detail] ?? e.detail)
        : null,
      e.action === "STAFF_GROUP_DECLINED" && e.detail ? `« ${e.detail} »` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  const q = query.trim().toLowerCase();
  const shown = data.filter(
    (e) =>
      (!category || e.category === category) &&
      (!q || `${e.staffName} ${e.subject ?? ""}`.toLowerCase().includes(q)),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.activity}</h1>
          <p className="muted small">{t.logHint}</p>
        </div>
        <div className="log-tools">
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="search" size={16} />
            <input
              type="search"
              value={query}
              placeholder={t.logSearch}
              aria-label={t.logSearch}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button className={category === null ? "on" : ""} onClick={() => setCategory(null)}>
            {t.logAll}
          </button>
          {CATEGORIES.map((c) => (
            <button key={c} className={category === c ? "on" : ""} onClick={() => setCategory(c)}>
              {t.logCats[c]}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="calm">{t.activityEmpty}</p>
      ) : (
        <table className="members">
          <thead>
            <tr>
              <th>{t.logWhen}</th>
              <th>{t.logWho}</th>
              <th>{t.logWhat}</th>
              <th>{t.logDetail}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e, i) => (
              <tr key={`${e.at}-${e.action}-${i}`}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>
                  {when(e.at)}
                </td>
                <td>
                  <strong>{e.staffName}</strong>
                </td>
                <td>
                  <span className={`log-dot dot-${e.category}`} aria-hidden="true" />
                  {t.actions[e.action]}
                </td>
                <td className="muted">{detail(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
