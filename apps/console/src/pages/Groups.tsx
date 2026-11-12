import type { ConsoleGroup } from "@novi/shared";
import { useState } from "react";
import { api } from "../api";
import { day, fcfa } from "../format";
import type { Text } from "../text";
import { useLoad } from "../useLoad";
import { ValidateGroup } from "../ValidateGroup";

type Filter = "WATCH" | "VALIDATE" | "ALL" | "DONE";

const keep: Record<Filter, (g: ConsoleGroup) => boolean> = {
  WATCH: (g) => g.health === "RED" || g.health === "AMBER",
  VALIDATE: (g) => g.state === "STARTING",
  ALL: () => true,
  DONE: (g) => g.state === "COMPLETED",
};

// Red first, then amber, then the rest by name.
const order = (g: ConsoleGroup) => (g.health === "RED" ? 0 : g.health === "AMBER" ? 1 : g.state === "STARTING" ? 2 : 3);

// "Groupes" (board 14, D116): every group at this MFI with its colour and the
// reason for it, filtered and searched, and exported for the MFI's own files.
// Totals only, never who paid (D33).
export function Groups({ t, onExpired }: { t: Text; onExpired: () => void }) {
  const { data, failed, reload } = useLoad(() => api<ConsoleGroup[]>("GET", "/v1/console/groups"), onExpired);
  const [chosen, setChosen] = useState<Filter | null>(null);
  const [query, setQuery] = useState("");
  const [justValidated, setJustValidated] = useState<string | null>(null);
  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;

  const count = (f: Filter) => data.filter(keep[f]).length;
  // D133: opens on every group (the ones to watch come first), so a group
  // just validated is there at once. A search looks through every group,
  // whatever the tab: a group never hides behind a filter.
  const filter = chosen ?? "ALL";
  const q = query.trim().toLowerCase();
  const shown = data
    .filter(q ? () => true : keep[filter])
    .filter((g) => !q || g.name.toLowerCase().includes(q) || (g.accountRef ?? "").toLowerCase().includes(q))
    .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));

  const reason = (g: ConsoleGroup) =>
    g.watch ? t.watchLine(g.watch) : g.state === "STARTING" ? t.tagValidate : g.state === "COMPLETED" ? t.groupState.COMPLETED : "";

  function exportCsv() {
    const rows = [
      t.groupsCsvHead,
      ...shown.map((g) => [
        g.name,
        g.accountRef ?? "",
        t.groupState[g.state] ?? g.state,
        g.amountFcfa,
        t.frequency[g.frequency],
        g.size,
        g.currentRound ?? "",
        g.rounds,
        g.nextPotDate ?? "",
        g.collectedFcfa,
        g.paidOutFcfa,
        g.balanceFcfa,
        g.reserveFcfa,
        g.onTimePct ?? "",
        reason(g),
      ]),
    ];
    // Semicolons and a BOM: what Excel opens directly with French settings.
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    link.download = `novi-groupes-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const chip = (f: Filter, label: string) => (
    <button className={`filter ${filter === f ? "on" : ""}`} onClick={() => setChosen(f)} aria-pressed={filter === f}>
      {f === "WATCH" ? (
        <>
          <span className="dot dot-red" aria-hidden="true" />
          <span className="dot dot-amber" aria-hidden="true" />
        </>
      ) : null}
      {label} · {count(f)}
    </button>
  );

  return (
    <>
      <div className="page-head">
        <h1>{t.groupsTitle}</h1>
        <button className="ghost" onClick={exportCsv} disabled={shown.length === 0}>
          {t.exportExcel}
        </button>
      </div>

      <div className="filters">
        {chip("WATCH", t.filterWatch)}
        {chip("VALIDATE", t.filterValidate)}
        {chip("ALL", t.filterAll)}
        {chip("DONE", t.filterDone)}
        <label className="search">
          <span className="sr-only">{t.searchGroup}</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.searchGroup} />
        </label>
      </div>

      <section className="queue">
        {shown.length === 0 ? (
          <p className="muted empty-line">{t.noGroupsHere}</p>
        ) : (
          <table className="members groups-table">
            <thead>
              <tr>
                <th>{t.colGroup}</th>
                <th>{t.colContribution}</th>
                <th>{t.colRound}</th>
                <th>{t.colNextPot}</th>
                <th className="num">{t.colHeld}</th>
                <th className="num">{t.colOnTime}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => (
                <tr
                  key={g.id}
                  className="clickable"
                  onClick={() => {
                    window.location.hash = `#/groups/${g.id}`;
                  }}
                >
                  <td>
                    <span className="group-cell">
                      <span
                        className={`dot ${g.health === "RED" ? "dot-red" : g.health === "AMBER" ? "dot-amber" : g.health === "GREEN" ? "dot-green" : "dot-none"}`}
                        aria-hidden="true"
                      />
                      <span>
                        <a href={`#/groups/${g.id}`} className="q-title">
                          {g.name}
                        </a>
                        {reason(g) ? <span className="q-meta">{reason(g)}</span> : null}
                        {justValidated === g.id ? <span className="q-meta paid-text">✓ {t.validatedNow}</span> : null}
                        {g.state === "STARTING" ? (
                          <ValidateGroup
                            t={t}
                            group={g}
                            onDone={(approved) => {
                              if (approved) setJustValidated(g.id);
                              setChosen("ALL");
                              reload();
                            }}
                          />
                        ) : null}
                      </span>
                    </span>
                  </td>
                  <td>
                    {fcfa(g.amountFcfa)} / {t.freqShort[g.frequency]}
                    <span className="q-meta">{t.membersShort(g.size)}</span>
                  </td>
                  <td>{g.currentRound ? t.roundShort(g.currentRound, g.rounds) : "–"}</td>
                  <td>
                    {g.state === "ACTIVE" && g.nextPotDate ? day(g.nextPotDate) : "–"}
                    {/* D130: a date already past is a pot on hold, not a next pot. */}
                    {g.state === "ACTIVE" && g.nextPotDate && g.nextPotDate.slice(0, 10) < new Date().toISOString().slice(0, 10) ? (
                      <span className="tag tag-orange" style={{ marginLeft: 6 }}>{t.potWaiting}</span>
                    ) : null}
                  </td>
                  <td className="num">{fcfa(g.balanceFcfa)}</td>
                  <td className="num">{g.onTimePct === null ? "–" : `${g.onTimePct} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
