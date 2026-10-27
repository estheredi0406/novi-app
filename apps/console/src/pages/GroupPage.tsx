import type { ConsoleGroupDetail } from "@novi/shared";
import { api } from "../api";
import { day, fcfa } from "../format";
import type { Text } from "../text";
import { useLoad } from "../useLoad";

// One group, round by round. Each round is drawn as a pot that fills as
// payments arrive. The receiver appears as a turn number, never a name (D33).
export function GroupPage({ t, groupId, onExpired }: { t: Text; groupId: string; onExpired: () => void }) {
  const { data, failed } = useLoad(() => api<ConsoleGroupDetail>("GET", `/v1/console/groups/${groupId}`), onExpired);

  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;

  return (
    <>
      <a href="#/" className="link back">
        ← {t.back}
      </a>
      <div className="group-head">
        <div>
          <h1>{data.name}</h1>
          <p className="card-meta">
            {fcfa(data.amountFcfa)} {t.perMember} · {data.frequency === "WEEKLY" ? t.weekly : t.monthly} · {t.account}{" "}
            {data.accountRef ?? "…"}
          </p>
        </div>
        <dl className="sums">
          <div>
            <dt>{t.collected}</dt>
            <dd>{fcfa(data.collectedFcfa)}</dd>
          </div>
          <div>
            <dt>{t.sent}</dt>
            <dd>{fcfa(data.paidOutFcfa)}</dd>
          </div>
          <div>
            <dt>{t.balance}</dt>
            <dd className="strong">{fcfa(data.balanceFcfa)}</dd>
          </div>
          <div>
            <dt>{t.reserveLabel}</dt>
            <dd>{fcfa(data.reserveFcfa)}</dd>
          </div>
        </dl>
      </div>

      <div className="pots">
        {data.roundList.map((round) => {
          const fill = round.expectedFcfa > 0 ? round.collectedFcfa / round.expectedFcfa : 0;
          const status = round.payout?.status ?? "NOT_DUE";
          const current = round.number === data.currentRound;
          return (
            <div key={round.number} className={`pot ${current ? "pot-current" : ""}`}>
              <div className="jar" role="img" aria-label={`${fcfa(round.collectedFcfa)} / ${fcfa(round.expectedFcfa)}`}>
                <div
                  className={`jar-fill jar-${status.toLowerCase()}`}
                  style={{ height: `${Math.round(fill * 100)}%` }}
                />
              </div>
              <strong>
                {t.round} {round.number}
              </strong>
              <span className="pot-line">{day(round.dueDate)}</span>
              <span className="pot-line">{t.payments(round.paymentsReceived, round.paymentsExpected)}</span>
              <span className={`chip chip-${status.toLowerCase()}`}>{t.status[status]}</span>
              <span className="pot-line muted">{t.turn(round.receiverTurn)}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
