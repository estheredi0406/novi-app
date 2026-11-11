import type { ConsoleGroup, ConsoleLoan, ConsoleOverview } from "@novi/shared";
import { useEffect, useState } from "react";
import { api } from "./api";

// The numbers on the sidebar (D92): everything in the overview's "À traiter"
// (pots to release, held, failed or disputed, payments reported, groups to
// validate, loan requests to look at), and the loan requests alone. A failed count simply shows nothing.
export function useCounts(active: boolean, routeKey: string) {
  const [counts, setCounts] = useState({ toDo: 0, loans: 0 });
  useEffect(() => {
    if (!active) return;
    let live = true;
    Promise.all([
      api<ConsoleOverview>("GET", "/v1/console/overview"),
      api<ConsoleGroup[]>("GET", "/v1/console/groups"),
      api<ConsoleLoan[]>("GET", "/v1/console/loans"),
    ])
      .then(([o, groups, loans]) => {
        if (!live) return;
        // The same count as "À traiter" on the overview.
        const openLoans = loans.filter(
          (l) => l.status === "PENDING" || (l.status === "PRESELECTED" && l.documentsSent > 0),
        ).length;
        setCounts({
          toDo:
            o.ready +
            o.held +
            o.failed +
            o.disputed +
            groups.filter((g) => g.state === "STARTING").length +
            o.reported +
            openLoans,
          loans: openLoans,
        });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [active, routeKey]);
  return counts;
}
