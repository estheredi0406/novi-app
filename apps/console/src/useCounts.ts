import type { ConsoleGroup, ConsoleLoan, ConsoleMoney, ConsoleOverview, ConsoleSavings } from "@novi/shared";
import { useEffect, useState } from "react";
import { api } from "./api";

// The numbers on the sidebar (D92): everything in the overview's "À traiter"
// (pots to release, held, failed or disputed, payments reported, groups to
// validate, loan requests to look at), and the loan requests alone. A failed count simply shows nothing.
export function useCounts(active: boolean, routeKey: string) {
  const [counts, setCounts] = useState({ toDo: 0, loans: 0, savings: 0, money: 0 });
  useEffect(() => {
    if (!active) return;
    let live = true;
    Promise.all([
      api<ConsoleOverview>("GET", "/v1/console/overview"),
      api<ConsoleGroup[]>("GET", "/v1/console/groups"),
      api<ConsoleLoan[]>("GET", "/v1/console/loans"),
      api<ConsoleSavings>("GET", "/v1/console/savings").catch(() => null),
      api<ConsoleMoney>("GET", "/v1/console/money").catch(() => null),
    ])
      .then(([o, groups, loans, savings, money]) => {
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
          // D123: savings accounts to open, before the member's pot day.
          savings: savings?.requests.length ?? 0,
          // D124: payments FedaPay confirmed for another amount.
          money: money?.toCheck.length ?? 0,
        });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [active, routeKey]);
  return counts;
}
