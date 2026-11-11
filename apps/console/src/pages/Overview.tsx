import type {
  AttentionItem,
  ConsoleGroup,
  ConsoleLoan,
  ConsoleOverview,
  ConsoleReported,
} from "@novi/shared";
import { useState } from "react";
import { MoneyViews } from "../Accounts";
import { api } from "../api";
import { day, fcfa } from "../format";
import { Icon, Ring } from "../Icon";
import { type Text, text } from "../text";
import { useLoad } from "../useLoad";

type Data = {
  overview: ConsoleOverview;
  attention: AttentionItem[];
  groups: ConsoleGroup[];
  loans: ConsoleLoan[];
  reported: ConsoleReported[];
};

// What the officer sees first (board K1, D92): three numbers, then one list
// of everything waiting for him, most urgent first, each with its own button
// (pots to release, problems, payments reported, groups to validate, loan requests,
// pots held), then every group. Totals only, never who paid (D33).
export function Overview({ t, onExpired }: { t: Text; onExpired: () => void }) {
  const { data, failed, reload } = useLoad<Data>(
    async () => ({
      overview: await api<ConsoleOverview>("GET", "/v1/console/overview"),
      attention: await api<AttentionItem[]>("GET", "/v1/console/attention"),
      groups: await api<ConsoleGroup[]>("GET", "/v1/console/groups"),
      loans: await api<ConsoleLoan[]>("GET", "/v1/console/loans"),
      reported: await api<ConsoleReported[]>("GET", "/v1/console/reported"),
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

  // D63: the officer confirms before a pot leaves the MFI. D105: above the
  // MFI's limit, this first click is only the first of two approvals.
  function release(item: AttentionItem) {
    const first = item.needsTwo && !item.firstApprovedBy;
    const question = first ? t.approveConfirm2(fcfa(item.amountFcfa)) : t.releaseConfirm(fcfa(item.amountFcfa));
    if (window.confirm(question)) void act(item.payoutId, "release");
  }

  // D105: a payment the member says left her account, checked by the officer
  // on the operator's statement.
  async function answer(item: ConsoleReported, arrived: boolean) {
    const question = arrived
      ? t.foundConfirm(fcfa(item.amountFcfa), item.memberName)
      : t.notFoundConfirm(item.memberName);
    if (!window.confirm(question)) return;
    setRetrying(item.contributionId);
    try {
      await api("POST", `/v1/console/reported/${item.contributionId}`, { arrived });
    } catch {
      window.alert(t.errors.default);
    } finally {
      setRetrying(null);
      reload();
    }
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
      await api(
        "POST",
        `/v1/console/groups/${group.id}/${approve ? "approve" : "decline"}`,
        body,
      );
    } finally {
      setRetrying(null);
      reload();
    }
  }

  const meta = (item: AttentionItem) =>
    item.status === "READY"
      ? item.firstApprovedBy
        ? `${t.firstBy(item.firstApprovedBy)} · ${t.needsSecond}`
        : t.readyHint(item.receiverTurn)
      : item.status === "DISPUTED"
        ? item.receiptCheck
          ? `${t.disputedHint} · ${t.receiptCheck[item.receiptCheck](item.sentTo ?? "", item.transferRef ?? "")}`
          : t.disputedHint
        : item.status === "HELD"
          ? t.missing(item.paymentsMissing)
          : item.nextRetryAt
            ? t.retryAt(item.nextRetryAt.slice(11, 16), item.attempts + 1, 4)
            : t.retriesUsed(item.attempts);
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
  const { overview, attention, groups, loans, reported } = data;
  const toValidate = groups.filter((g) => g.state === "STARTING");
  const openLoans = loans.filter(
    (l) => l.status === "PENDING" || (l.status === "PRESELECTED" && l.documentsSent > 0),
  );
  const rank = { READY: 0, DISPUTED: 1, FAILED: 2, HELD: 5 } as const;
  const byUrgency = [...attention].sort((a, b) => rank[a.status] - rank[b.status]);
  // D114: a refused transfer Novi will try again by itself is only watched;
  // it needs the officer once its automatic tries are used up.
  const watched = (i: AttentionItem) => i.status === "HELD" || (i.status === "FAILED" && i.nextRetryAt !== null);
  const now = byUrgency.filter((i) => !watched(i));
  const held = byUrgency.filter(watched);
  const total = attention.length + toValidate.length + openLoans.length + reported.length;

  const payoutRow = (item: AttentionItem) => {
    const kind =
      item.status === "READY" ? "money" : item.status === "HELD" ? "wait" : "problem";
    const tag =
      item.status === "READY" ? "orange" : item.status === "HELD" ? "wait" : "red";
    return (
      <li key={item.payoutId} className="q">
        <span className={`q-icon q-${kind}`}>
          <Icon name={item.status === "READY" ? "coin" : "alert"} size={22} />
        </span>
        <div>
          <a href={`#/groups/${item.groupId}`} className="q-title">
            {item.groupName} · {t.round} {item.roundNumber}
          </a>
          <span className="q-meta">
            {meta(item)} · {t.since(day(item.since))}
          </span>
        </div>
        <span className={`tag tag-${tag}`}>{label(item)}</span>
        <span className="q-amount">{fcfa(item.amountFcfa)}</span>
        <div className="q-actions">
          {item.canRelease ? (
            <button className="primary small" disabled={retrying === item.payoutId} onClick={() => release(item)}>
              {!item.needsTwo ? t.release : item.firstApprovedBy ? t.releaseSecond : t.approveFirst}
            </button>
          ) : item.status === "READY" && item.firstApprovedBy ? (
            <span className="muted small">{t.waitSecond}</span>
          ) : item.canRetry ? (
            <button
              className="primary small"
              disabled={retrying === item.payoutId}
              onClick={() => void act(item.payoutId, "retry")}
            >
              {t.retry}
            </button>
          ) : (
            <a className="ghost" href={`#/groups/${item.groupId}`}>
              {t.see}
            </a>
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted small">{new Date().toLocaleDateString(t === text.en ? "en-GB" : "fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
          <h1>{overview.mfiName}</h1>
        </div>
      </div>

      <section className="kpis">
        <div>
          <span className="tile-label">{t.balance}</span>
          <span className="tile-number">{fcfa(overview.balanceFcfa)}</span>
          <span className="tile-hint">{t.balanceHint}</span>
        </div>
        <div>
          <span className="tile-label">{t.active}</span>
          <span className="tile-number">{overview.activeGroups}</span>
          <span className="tile-hint">
            {overview.completedGroups} {t.completed}
          </span>
        </div>
        <div>
          <span className="tile-label">{t.queueTitle}</span>
          <span className={`tile-number ${total === 0 ? "good" : ""}`}>{total}</span>
          <span className="tile-hint">
            {overview.ready} {t.ready.toLowerCase()} · {overview.held} {t.held.toLowerCase()} · {overview.failed}{" "}
            {t.failed.toLowerCase()}
            {overview.disputed > 0 ? ` · ${overview.disputed} ${t.disputed.toLowerCase()}` : ""}
            {overview.reported > 0 ? ` · ${overview.reported} ${t.tagReported.toLowerCase()}` : ""}
          </span>
        </div>
      </section>

      <MoneyViews t={t} onExpired={onExpired} />

      <section className="queue" aria-labelledby="queue-title">
        <div className="queue-head">
          <h2 id="queue-title">{t.queueTitle}</h2>
          <span className="muted small">{total > 0 ? t.queueCount(total) : ""}</span>
        </div>
        {total === 0 ? (
          <p className="muted" style={{ padding: "4px 24px 22px", margin: 0 }}>
            {t.nothingToLook}
          </p>
        ) : (
          <ol>
            {now.map(payoutRow)}
            {reported.map((item) => (
              <li key={item.contributionId} className="q">
                <span className="q-icon q-problem">
                  <Icon name="alert" size={22} />
                </span>
                <div>
                  <a href={`#/groups/${item.groupId}`} className="q-title">
                    {item.memberName} · {item.groupName} · {t.round} {item.roundNumber}
                  </a>
                  <span className="q-meta">
                    {t.reportedLine(item.operator, item.phone, day(item.reportedAt))} · {t.autoChecked(item.autoChecks)}
                  </span>
                </div>
                <span className="tag tag-red">{t.tagReported}</span>
                <span className="q-amount">{fcfa(item.amountFcfa)}</span>
                <div className="q-actions">
                  <button
                    className="primary small"
                    disabled={retrying === item.contributionId}
                    onClick={() => void answer(item, true)}
                  >
                    {t.paymentFound}
                  </button>
                  <button
                    className="link"
                    disabled={retrying === item.contributionId}
                    onClick={() => void answer(item, false)}
                  >
                    {t.paymentNotFound}
                  </button>
                </div>
              </li>
            ))}
            {toValidate.map((group) => (
              <li key={group.id} className="q">
                <span className="q-icon q-group">
                  <Icon name="groups" size={22} />
                </span>
                <div>
                  <a href={`#/groups/${group.id}`} className="q-title">
                    {group.name}
                  </a>
                  <span className="q-meta">
                    {fcfa(group.amountFcfa)} {t.perMember} · {t.frequency[group.frequency]} · {group.size}{" "}
                    {t.members.toLowerCase()}
                  </span>
                </div>
                <span className="tag tag-blue">{t.tagValidate}</span>
                <span className="q-amount">{fcfa(group.amountFcfa * group.size)}</span>
                <div className="q-actions">
                  <a className="ghost" href={`#/groups/${group.id}`}>
                    {t.seeMembers}
                  </a>
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
                </div>
              </li>
            ))}
            {openLoans.map((loan) => (
              <li key={loan.id} className="q">
                <span className="q-icon q-group">
                  <Icon name="bank" size={22} />
                </span>
                <div>
                  <a href={`#/loans/${loan.id}`} className="q-title">
                    {loan.memberName} · {t.loanLine}
                  </a>
                  <span className="q-meta">
                    {loan.status === "PRESELECTED"
                      ? t.documentsToCheck(loan.documentsSent)
                      : `${t.loanPurpose[loan.purpose]} · ${t.loanMonths(loan.months)}`}
                  </span>
                </div>
                <span className={`tag ${loan.status === "PRESELECTED" ? "tag-wait" : "tag-blue"}`}>
                  {loan.status === "PRESELECTED" ? t.tagDocs : t.tagNew}
                </span>
                <span className="q-amount">{fcfa(loan.amountFcfa)}</span>
                <div className="q-actions">
                  <a className="ghost" href={`#/loans/${loan.id}`}>
                    {t.examine}
                  </a>
                </div>
              </li>
            ))}
            {held.map(payoutRow)}
          </ol>
        )}
      </section>

      <section className="queue">
        <div className="queue-head">
          <h2>{t.allGroups}</h2>
        </div>
        {groups.length === 0 ? (
          <p className="muted" style={{ padding: "4px 24px 22px", margin: 0 }}>
            {t.noGroups}
          </p>
        ) : (
          <table className="members" style={{ boxShadow: "none" }}>
            <thead>
              <tr>
                <th style={{ width: 70 }}>{t.potsCol}</th>
                <th>{t.colGroup}</th>
                <th>{t.colRound}</th>
                <th>{t.balance}</th>
                <th>{t.colState}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr
                  key={group.id}
                  className="clickable"
                  onClick={() => {
                    window.location.hash = `#/groups/${group.id}`;
                  }}
                >
                  <td>
                    <div className="ring-cell" aria-hidden="true">
                      <Ring paid={group.potsPaid} size={group.rounds || group.size} />
                      <span>
                        {group.potsPaid}/{group.rounds || group.size}
                      </span>
                    </div>
                  </td>
                  <td>
                    <a href={`#/groups/${group.id}`} className="q-title">
                      {group.name}
                    </a>
                    <span className="q-meta">
                      {fcfa(group.amountFcfa)} {t.perMember} · {t.frequency[group.frequency]} · {group.size}{" "}
                      {t.members.toLowerCase()}
                    </span>
                  </td>
                  <td>{group.currentRound ? t.roundOf(group.currentRound, group.rounds) : "…"}</td>
                  <td>{fcfa(group.balanceFcfa)}</td>
                  <td>
                    {group.needsAttention > 0 ? (
                      <span className="tag tag-orange">{t.toLook}</span>
                    ) : group.state === "STARTING" ? (
                      <span className="tag tag-blue">{t.tagValidate}</span>
                    ) : (
                      <span className="muted">{t.groupState[group.state]}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
