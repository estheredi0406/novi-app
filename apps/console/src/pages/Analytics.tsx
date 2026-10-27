import type { ConsoleAnalytics } from "@novi/shared";
import { api } from "../api";
import { day, fcfa } from "../format";
import type { Text } from "../text";
import { useLoad } from "../useLoad";

// The MFI's Novi portfolio over the last eight weeks (D67). Totals only,
// never a member's name (D33).
export function Analytics({ t, onExpired }: { t: Text; onExpired: () => void }) {
  const { data, failed } = useLoad(() => api<ConsoleAnalytics>("GET", "/v1/console/analytics"), onExpired);
  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;

  const percent = (value: number | null) => (value === null ? "–" : `${value} %`);
  return (
    <>
      <h1>{t.analytics}</h1>
      <section className="tiles tiles-4">
        <div className="tile">
          <span className="tile-label">{t.members}</span>
          <span className="tile-number">{data.members}</span>
          <span className="tile-hint">{t.membersHint}</span>
        </div>
        <div className="tile">
          <span className="tile-label">{t.onTimeRate}</span>
          <span className="tile-number">{percent(data.onTimeRate)}</span>
          <span className="tile-hint">{t.onTimeHint}</span>
        </div>
        <div className={`tile ${data.potsDisputed > 0 ? "tile-alert" : ""}`}>
          <span className="tile-label">{t.potsPaid}</span>
          <span className="tile-number">{data.potsPaid}</span>
          <span className="tile-hint">{t.potsHint(data.potsDisputed, percent(data.receiptConfirmedRate))}</span>
        </div>
        <div className="tile">
          <span className="tile-label">{t.releaseWait}</span>
          <span className="tile-number">
            {data.medianReleaseHours === null ? "–" : t.hours(data.medianReleaseHours)}
          </span>
          <span className="tile-hint">{t.releaseWaitHint}</span>
        </div>
      </section>
      <p className="calm">{t.groupsStates(data.groups)}</p>

      <h2>{t.weeksTitle}</h2>
      <WeeksChart t={t} weeks={data.weeks} />

      <h2>{t.byGroupTitle}</h2>
      <p className="muted">{t.byGroupHint}</p>
      {data.byGroup.length === 0 ? (
        <p className="calm">{t.noData}</p>
      ) : (
        <div className="table-card">
          <table className="byGroup">
            <thead>
              <tr>
                <th>{t.colGroup}</th>
                <th className="num">{t.colMembers}</th>
                <th className="num">{t.colCollected}</th>
                <th>{t.colOnTime}</th>
                <th className="num">{t.colCycle}</th>
                <th className="num">{t.colDisputed}</th>
              </tr>
            </thead>
            <tbody>
              {data.byGroup.map((g) => (
                <tr key={g.groupId}>
                  <td>
                    <a href={`#/groups/${g.groupId}`}>{g.name}</a>
                  </td>
                  <td className="num">{g.members}</td>
                  <td className="num">{fcfa(g.collectedFcfa)}</td>
                  <td>
                    {g.onTimeRate === null ? (
                      "–"
                    ) : (
                      <span className="meter">
                        <span className="meter-bar">
                          <span style={{ width: `${g.onTimeRate}%` }} />
                        </span>
                        <strong>{g.onTimeRate} %</strong>
                      </span>
                    )}
                  </td>
                  <td className="num">
                    {g.roundsPaidOut}/{g.rounds}
                  </td>
                  <td className={`num ${g.disputed > 0 ? "alert" : ""}`}>{g.disputed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// Paired bars per week: collected (navy) and paid out (orange), with the
// on-time share of that week's payments underneath. Drawn in SVG, no library.
function WeeksChart({ t, weeks }: { t: Text; weeks: ConsoleAnalytics["weeks"] }) {
  const max = Math.max(1, ...weeks.flatMap((w) => [w.collectedFcfa, w.paidOutFcfa]));
  if (weeks.every((w) => w.collectedFcfa === 0 && w.paidOutFcfa === 0)) return <p className="calm">{t.noData}</p>;
  const W = 760;
  const H = 260;
  const top = 16;
  const base = 200;
  const slot = W / weeks.length;
  const bar = Math.min(26, slot / 3);
  const height = (v: number) => ((base - top) * v) / max;

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.weeksTitle}>
        <line x1="0" x2={W} y1={base} y2={base} stroke="#1B1F4B" strokeWidth="1.5" />
        {weeks.map((w, i) => {
          const x = i * slot + slot / 2;
          const rate = w.payments ? Math.round((w.onTime / w.payments) * 100) : null;
          return (
            <g key={w.weekOf}>
              <rect
                x={x - bar - 2}
                y={base - height(w.collectedFcfa)}
                width={bar}
                height={height(w.collectedFcfa)}
                rx="4"
                fill="#1B1F4B"
              >
                <title>{`${t.collectedLegend} ${fcfa(w.collectedFcfa)}`}</title>
              </rect>
              <rect
                x={x + 2}
                y={base - height(w.paidOutFcfa)}
                width={bar}
                height={height(w.paidOutFcfa)}
                rx="4"
                fill="#F05A1A"
              >
                <title>{`${t.paidOutLegend} ${fcfa(w.paidOutFcfa)}`}</title>
              </rect>
              <text x={x} y={base + 20} textAnchor="middle" fontSize="12" fill="#3A3D6B">
                {day(w.weekOf).slice(0, 5)}
              </text>
              <text
                x={x}
                y={base + 38}
                textAnchor="middle"
                fontSize="12"
                fontWeight="700"
                fill={rate === null ? "#A9A6D6" : "#1E7A4C"}
              >
                {rate === null ? "–" : `${rate} %`}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        <span className="key key-navy" /> {t.collectedLegend} <span className="key key-orange" /> {t.paidOutLegend} ·{" "}
        <strong style={{ color: "#1E7A4C" }}>%</strong> {t.onTimeRate.toLowerCase()}
      </figcaption>
    </figure>
  );
}
