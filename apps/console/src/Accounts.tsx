import type { ConsoleGroupAccount } from "@novi/shared";
import { api } from "./api";
import { day, fcfa } from "./format";
import type { Text } from "./text";
import { useLoad } from "./useLoad";

const time = (iso: string) => iso.slice(11, 16);

// D113: one group's account at the MFI, as its banking system would show it.
export function GroupStatement({ t, groupId, onExpired }: { t: Text; groupId: string; onExpired: () => void }) {
  const { data } = useLoad(
    () => api<ConsoleGroupAccount | null>("GET", `/v1/console/groups/${groupId}/account`),
    onExpired,
  );
  if (!data) return null;
  return (
    <section className="queue">
      <div className="queue-head">
        <h2>{t.statementTitle(data.ref)}</h2>
        <span className="muted small">{t.statementBalance(fcfa(data.balanceFcfa))}</span>
      </div>
      <div>
        <table className="members groups-table statement">
          <thead>
            <tr>
              <th>{t.colDate}</th>
              <th>{t.colLabel}</th>
              <th className="num">{t.colAmount}</th>
              <th className="num">{t.colBalanceAfter}</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e, i) => (
              <tr key={i}>
                {/* D150: when the money moved, not when the simulated books wrote it. */}
                <td>
                  {day(e.occurredAt)} {time(e.occurredAt)}
                </td>
                <td>{e.label}</td>
                <td className={`num ${e.amountFcfa < 0 ? "" : "paid-text"}`}>
                  {e.amountFcfa > 0 ? "+" : "−"}
                  {fcfa(Math.abs(e.amountFcfa))}
                </td>
                <td className="num">{fcfa(e.balanceAfterFcfa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
