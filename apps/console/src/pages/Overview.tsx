import type { AttentionItem, ConsoleGroup, ConsoleOverview } from "@novi/shared";
import { useState } from "react";
import { api } from "../api";
import { day, fcfa } from "../format";
import type { Text } from "../text";
import { useLoad } from "../useLoad";

type Data = { overview: ConsoleOverview; attention: AttentionItem[]; groups: ConsoleGroup[] };

// What the officer sees first: three numbers, then what needs a look, then
// every group. Totals only, never who paid (D33).
export function Overview({ t, onExpired }: { t: Text; onExpired: () => void }) {
  const { data, failed, reload } = useLoad<Data>(
    async () => ({
      overview: await api<ConsoleOverview>("GET", "/v1/console/overview"),
      attention: await api<AttentionItem[]>("GET", "/v1/console/attention"),
      groups: await api<ConsoleGroup[]>("GET", "/v1/console/groups"),
    }),
    onExpired,
  );
  const [retrying, setRetrying] = useState<string | null>(null);

  async function retry(payoutId: string) {
    setRetrying(payoutId);
    try {
      await api("POST", `/v1/console/payouts/${payoutId}/retry`);
    } finally {
      setRetrying(null);
      reload();
    }
  }

  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;
  const { overview, attention, groups } = data;

  return (
    <>
      <section className="tiles">
        <div className="tile">
          <span className="tile-label">{t.balance}</span>
          <span className="tile-number">{fcfa(overview.balanceFcfa)}</span>
          <span className="tile-hint">{t.balanceHint}</span>
        </div>
        <div className="tile">
          <span className="tile-label">{t.active}</span>
          <span className="tile-number">{overview.activeGroups}</span>
          <span className="tile-hint">
            {overview.completedGroups} {t.completed}
          </span>
        </div>
        <div className={`tile ${overview.held + overview.failed > 0 ? "tile-alert" : ""}`}>
          <span className="tile-label">{t.toLook}</span>
          <span className="tile-number">{overview.held + overview.failed}</span>
          <span className="tile-hint">
            {overview.held} {t.held.toLowerCase()} · {overview.failed} {t.failed.toLowerCase()}
          </span>
        </div>
      </section>

      <h2>{t.toLook}</h2>
      {attention.length === 0 ? (
        <p className="calm">{t.nothingToLook}</p>
      ) : (
        <ul className="attention">
          {attention.map((item) => (
            <li key={item.payoutId} className={`flag flag-${item.status.toLowerCase()}`}>
              <div>
                <a href={`#/groups/${item.groupId}`} className="flag-title">
                  {item.groupName} · {t.round} {item.roundNumber}
                </a>
                <span className="flag-meta">
                  {item.status === "HELD" ? t.missing(item.paymentsMissing) : t.failed} · {t.since(day(item.since))}
                </span>
              </div>
              <span className="flag-amount">{fcfa(item.amountFcfa)}</span>
              <span className={`chip chip-${item.status.toLowerCase()}`}>{item.status === "HELD" ? t.held : t.failed}</span>
              {item.canRetry && (
                <button className="primary small" disabled={retrying === item.payoutId} onClick={() => void retry(item.payoutId)}>
                  {t.retry}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>{t.groups}</h2>
      {groups.length === 0 ? (
        <p className="calm">{t.noGroups}</p>
      ) : (
        <div className="cards">
          {groups.map((group) => (
            <a key={group.id} href={`#/groups/${group.id}`} className="card">
              <span className="card-title">{group.name}</span>
              <span className="card-meta">
                {fcfa(group.amountFcfa)} {t.perMember} · {group.frequency === "WEEKLY" ? t.weekly : t.monthly}
              </span>
              <span className="card-number">{fcfa(group.balanceFcfa)}</span>
              <span className="card-meta">
                {group.currentRound ? `${t.round} ${group.currentRound} ${t.of} ${group.rounds}` : t.status.PAID}
                {group.needsAttention > 0 && <span className="dot" aria-label={t.toLook} />}
              </span>
              <span className="card-foot">
                {t.account} {group.accountRef ?? "…"}
              </span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
