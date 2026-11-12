import type { AttentionItem, ConsoleGroup, ConsoleLoan, ConsoleOverview, ConsoleReported, ConsoleToday } from "@novi/shared";
import { useState } from "react";
import { MoneyViews } from "../Accounts";
import { api } from "../api";
import { day, fcfa } from "../format";
import { type Text, text } from "../text";
import { useLoad } from "../useLoad";

type Data = {
  today: ConsoleToday;
  attention: AttentionItem[];
  groups: ConsoleGroup[];
  loans: ConsoleLoan[];
  reported: ConsoleReported[];
  overview: ConsoleOverview;
};

// "Aujourd'hui" (board 11, D116): today's figures, the accounts (D113), what
// Novi settled by itself (D114), what only a person can decide, and the
// groups to keep an eye on. Everything that went normally stays out of the
// way. Totals only, never who paid (D33), except a reported payment, which
// the officer must find on the operator's statement.
export function Overview({ t, onExpired }: { t: Text; onExpired: () => void }) {
  const { data, failed, reload } = useLoad<Data>(
    async () => ({
      today: await api<ConsoleToday>("GET", "/v1/console/today"),
      attention: await api<AttentionItem[]>("GET", "/v1/console/attention"),
      groups: await api<ConsoleGroup[]>("GET", "/v1/console/groups"),
      loans: await api<ConsoleLoan[]>("GET", "/v1/console/loans"),
      reported: await api<ConsoleReported[]>("GET", "/v1/console/reported"),
      overview: await api<ConsoleOverview>("GET", "/v1/console/overview"),
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

  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;
  const { today, attention, groups, loans, reported } = data;
  const toValidate = groups.filter((g) => g.state === "STARTING");
  const openLoans = loans.filter(
    (l) => l.status === "PENDING" || (l.status === "PRESELECTED" && l.documentsSent > 0),
  );
  // D114: a refused pot Novi will try again by itself, and a pot not yet
  // full, are only watched; everything else here needs a person.
  const decideNow = attention.filter(
    (i) => i.status !== "HELD" && !(i.status === "FAILED" && i.nextRetryAt !== null),
  );
  const rank = { READY: 0, DISPUTED: 1, FAILED: 2, HELD: 5 } as const;
  decideNow.sort((a, b) => rank[a.status] - rank[b.status]);
  const toDecide = decideNow.length + reported.length + toValidate.length;
  // The groups to keep an eye on: what is being settled, by Novi or the member.
  const watched = groups
    .filter((g) => g.watch && ["DEFAULT", "HELD", "RETRYING", "COVERED"].includes(g.watch.reason))
    .sort((a, b) => (a.health === b.health ? 0 : a.health === "RED" ? -1 : 1));
  const auto = today.auto;
  const autoTotal = auto.lateConfirmed + auto.potsAutoReleased + auto.transfersRetried;
  const dateLabel = new Date().toLocaleDateString(t === text.en ? "en-GB" : "fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const payoutRow = (item: AttentionItem) => {
    const tag =
      item.status === "READY"
        ? item.firstApprovedBy
          ? ["wait", t.tagSecond]
          : ["orange", t.ready]
        : item.status === "DISPUTED"
          ? ["red", t.disputed]
          : ["red", t.tagFixNumber];
    const meta =
      item.status === "READY"
        ? item.firstApprovedBy
          ? t.firstBy(item.firstApprovedBy)
          : t.readyHint(item.receiverTurn)
        : item.status === "DISPUTED"
          ? item.receiptCheck
            ? `${t.disputedHint} · ${t.receiptCheck[item.receiptCheck](item.sentTo ?? "", item.transferRef ?? "")}`
            : t.disputedHint
          : t.retriesUsed(item.attempts);
    return (
      <li key={item.payoutId} className="q">
        <span className={`tag tag-${tag[0]}`}>{tag[1]}</span>
        <div>
          <a href={`#/groups/${item.groupId}`} className="q-title">
            {item.groupName} · {t.round} {item.roundNumber}
          </a>
          <span className="q-meta">
            {meta} · {t.since(day(item.since))}
          </span>
        </div>
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
          <p className="muted small first-cap">{dateLabel}</p>
          <h1>{t.overview}</h1>
        </div>
      </div>

      <section className="kpis four">
        <div>
          <span className="tile-label">{t.todayReceived}</span>
          <span className="tile-number">{fcfa(today.receivedFcfa)}</span>
          <span className="tile-hint">{t.todayPayments(today.payments)}</span>
        </div>
        <div>
          <span className="tile-label">{t.todayPotsSent}</span>
          <span className="tile-number">{today.potsSent}</span>
          <span className="tile-hint">{fcfa(today.potsSentFcfa)}</span>
        </div>
        <div>
          <span className="tile-label">{t.todayHeld}</span>
          <span className={`tile-number ${today.potsHeld > 0 ? "warn-text" : ""}`}>{today.potsHeld}</span>
          <span className="tile-hint">{t.todayHeldHint}</span>
        </div>
        <div>
          <span className="tile-label">{t.todaySavings}</span>
          <span className="tile-number">{fcfa(today.savingsFcfa)}</span>
          <span className="tile-hint">{t.todayAdvances(fcfa(today.advancesFcfa))}</span>
        </div>
      </section>

      {/* D134: no ceiling until the institution chooses one. */}
      {!data.overview.autoReleaseChosen ? (
        <section className="queue choose-ceiling">
          <div className="queue-head">
            <h2>{t.autoChooseTitle}</h2>
            <a className="button-secondary" href="#/team">
              {t.autoChooseLink}
            </a>
          </div>
          <p className="muted" style={{ padding: "0 24px 18px", margin: 0 }}>
            {t.autoChooseBody}
          </p>
        </section>
      ) : null}

      <MoneyViews t={t} onExpired={onExpired} />

      {autoTotal > 0 ? (
        <section className="queue">
          <div className="queue-head">
            <h2>{t.settledTitle}</h2>
          </div>
          <div className="auto-row">
            {auto.lateConfirmed > 0 ? (
              <span>
                <b>{auto.lateConfirmed}</b> {t.autoLate(auto.lateConfirmed)}
                {auto.reportsCleared > 0 ? ` (${t.autoCleared(auto.reportsCleared)})` : ""}
              </span>
            ) : null}
            {auto.potsAutoReleased > 0 ? (
              <span>
                <b>{auto.potsAutoReleased}</b> {t.autoReleased(auto.potsAutoReleased)}
              </span>
            ) : null}
            {auto.transfersRetried > 0 ? (
              <span>
                <b>{auto.transfersRetried}</b> {t.autoRetried(auto.transfersRetried)}
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="queue" aria-labelledby="decide-title">
        <div className="queue-head">
          <h2 id="decide-title">{t.decideTitle}</h2>
          <span className="muted small">{toDecide > 0 ? toDecide : ""}</span>
        </div>
        {toDecide === 0 && openLoans.length === 0 ? (
          <p className="muted empty-line">{t.nothingToDecide}</p>
        ) : (
          <ol>
            {decideNow.map(payoutRow)}
            {reported.map((item) => (
              <li key={item.contributionId} className="q">
                <span className="tag tag-red">{t.tagReported}</span>
                <div>
                  <a href={`#/groups/${item.groupId}`} className="q-title">
                    {item.memberName} · {item.groupName} · {t.round} {item.roundNumber}
                  </a>
                  <span className="q-meta">
                    {t.reportedLine(t.operatorName[item.operator] ?? item.operator, item.phone, day(item.reportedAt))}
                    {item.providerRef ? ` · ${t.ref} ${item.providerRef}` : ""} · {t.autoChecked(item.autoChecks)}
                  </span>
                </div>
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
                <span className="tag tag-blue">{t.tagValidate}</span>
                <div>
                  <a href={`#/groups/${group.id}`} className="q-title">
                    {group.name}
                  </a>
                  <span className="q-meta">
                    {group.size} {t.members.toLowerCase()} · {fcfa(group.amountFcfa)} · {t.frequency[group.frequency]}
                  </span>
                </div>
                <span className="q-amount" />
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
            {openLoans.length > 0 ? (
              <li className="q q-line">
                <b>{t.loansWaiting(openLoans.length)}</b>
                <a href="#/loans">{t.see}</a>
              </li>
            ) : null}
          </ol>
        )}
      </section>

      <section className="queue" aria-labelledby="watch-title">
        <div className="queue-head">
          <h2 id="watch-title">{t.watchTitle}</h2>
          <span className="muted small">{watched.length > 0 ? watched.length : ""}</span>
        </div>
        {watched.length === 0 ? (
          <p className="muted empty-line">{t.nothingToWatch}</p>
        ) : (
          <ol>
            {watched.map((g) => (
              <li key={g.id} className="q q-watch">
                <span className={`dot dot-${g.health === "RED" ? "red" : "amber"}`} aria-hidden="true" />
                <div>
                  <a href={`#/groups/${g.id}`} className="q-title">
                    {g.name}
                  </a>
                  <span className="q-meta">{g.watch ? t.watchLine(g.watch) : ""}</span>
                </div>
                {(() => {
                  // D138: a refused pot Novi will try again later can be
                  // tried now, once the cause is fixed (a wallet, the
                  // payment account). It never sends twice.
                  const failed =
                    g.watch?.reason === "RETRYING"
                      ? attention.find((i) => i.groupId === g.id && i.status === "FAILED" && i.canRetry)
                      : undefined;
                  return failed ? (
                    <button
                      className="primary small"
                      disabled={retrying === failed.payoutId}
                      onClick={() => void act(failed.payoutId, "retry")}
                    >
                      {t.retryNow}
                    </button>
                  ) : (
                    <a className="ghost" href={`#/groups/${g.id}`}>
                      {t.open}
                    </a>
                  );
                })()}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
