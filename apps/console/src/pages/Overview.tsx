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

  async function act(payoutId: string, action: "retry" | "release") {
    setRetrying(payoutId);
    try {
      await api("POST", `/v1/console/payouts/${payoutId}/${action}`);
    } finally {
      setRetrying(null);
      reload();
    }
  }

  // D63: the officer confirms before a pot leaves the MFI.
  function release(item: AttentionItem) {
    if (window.confirm(t.releaseConfirm(fcfa(item.amountFcfa)))) void act(item.payoutId, "release");
  }

  // D66: a group members have started waits for the officer before its account opens.
  async function decide(group: ConsoleGroup, approve: boolean) {
    let body: { reason: string } | undefined;
    if (approve) {
      if (!window.confirm(t.approveConfirm(group.name))) return;
    } else {
      const reason = window.prompt(t.declineAsk)?.trim();
      if (!reason || reason.length < 3) return;
      body = { reason };
    }
    setRetrying(group.id);
    try {
      await api("POST", `/v1/console/groups/${group.id}/${approve ? "approve" : "decline"}`, body);
    } finally {
      setRetrying(null);
      reload();
    }
  }

  const meta = (item: AttentionItem) =>
    item.status === "READY"
      ? t.readyHint(item.receiverTurn)
      : item.status === "DISPUTED"
        ? t.disputedHint
        : item.status === "HELD"
          ? t.missing(item.paymentsMissing)
          : t.failed;
  const label = (item: AttentionItem) =>
    item.status === "READY"
      ? t.ready
      : item.status === "DISPUTED"
        ? t.disputed
        : item.status === "HELD"
          ? t.held
          : t.failed;

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
        <div
          className={`tile ${overview.held + overview.failed + overview.ready + overview.disputed > 0 ? "tile-alert" : ""}`}
        >
          <span className="tile-label">{t.toLook}</span>
          <span className="tile-number">{overview.held + overview.failed + overview.ready + overview.disputed}</span>
          <span className="tile-hint">
            {overview.ready} {t.ready.toLowerCase()} · {overview.held} {t.held.toLowerCase()} · {overview.failed}{" "}
            {t.failed.toLowerCase()}
            {overview.disputed > 0 ? ` · ${overview.disputed} ${t.disputed.toLowerCase()}` : ""}
          </span>
        </div>
      </section>

      {groups.some((g) => g.state === "STARTING") && (
        <>
          <h2>{t.toValidate}</h2>
          <p className="calm">{t.toValidateHint}</p>
          <ul className="attention">
            {groups
              .filter((g) => g.state === "STARTING")
              .map((group) => (
                <li key={group.id} className="flag flag-ready">
                  <div>
                    <span className="flag-title">{group.name}</span>
                    <span className="flag-meta">
                      {fcfa(group.amountFcfa)} {t.perMember} · {group.frequency === "WEEKLY" ? t.weekly : t.monthly} ·{" "}
                      {group.size} {t.members.toLowerCase()}
                    </span>
                  </div>
                  <span className="flag-amount">{fcfa(group.amountFcfa * group.size)}</span>
                  <span />
                  <button
                    className="primary small"
                    disabled={retrying === group.id}
                    onClick={() => void decide(group, true)}
                  >
                    {t.approve}
                  </button>
                  <button className="link" disabled={retrying === group.id} onClick={() => void decide(group, false)}>
                    {t.decline}
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}

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
                  {meta(item)} · {t.since(day(item.since))}
                </span>
              </div>
              <span className="flag-amount">{fcfa(item.amountFcfa)}</span>
              <span className={`chip chip-${item.status.toLowerCase()}`}>{label(item)}</span>
              {item.canRelease && (
                <button className="primary small" disabled={retrying === item.payoutId} onClick={() => release(item)}>
                  {t.release}
                </button>
              )}
              {item.canRetry && (
                <button
                  className="primary small"
                  disabled={retrying === item.payoutId}
                  onClick={() => void act(item.payoutId, "retry")}
                >
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
