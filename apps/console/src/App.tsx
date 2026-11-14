import type { StaffLoginResponse, StaffProfile } from "@novi/shared";
import { useEffect, useState } from "react";
import { api, session } from "./api";
import { GroupPage } from "./pages/GroupPage";
import { Groups } from "./pages/Groups";
import { Compliance } from "./pages/Compliance";
import { Settings } from "./pages/Settings";
import { Login } from "./pages/Login";
import { Overview } from "./pages/Overview";
import { RecordPage, Records } from "./pages/Records";
import { type Lang, text } from "./text";
import { Activity } from "./pages/Activity";
import { Analytics } from "./pages/Analytics";
import { Members } from "./pages/Members";
import { FirstPassword } from "./pages/FirstPassword";
import { Team } from "./pages/Team";
import { LoanPage, LoanPolicy, Loans } from "./pages/Loans";
import { Savings } from "./pages/Savings";
import { Money } from "./pages/Money";
import { Icon, type IconName } from "./Icon";
import { useCounts } from "./useCounts";

// The console's pages come from the part after "#" in the address, so the back
// button works without a router library (D116).
function useRoute(): string[] {
  const read = () =>
    window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

// The officer's language choice survives a refresh: it is kept in this
// browser. Storage can be blocked (private window), so failures are ignored.
const LANG_KEY = "novi.console.lang";
function savedLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}

export function App() {
  const [lang, setLangState] = useState<Lang>(savedLang);
  const setLang = (next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // the choice then lasts until the page is closed
    }
  };
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [checking, setChecking] = useState(Boolean(session.get()));
  // D81: the temporary password typed at login, so the first-login page
  // does not ask for it again.
  const [temporary, setTemporary] = useState<string | null>(null);
  const route = useRoute();
  const t = text[lang];
  // D92: how many things wait in "Aujourd'hui" and in "Crédits", for the
  // sidebar. Refreshed on every page change.
  const counts = useCounts(Boolean(staff && !staff.mustChangePassword), route.join("/"));

  // A token from earlier in this tab: check it is still valid.
  useEffect(() => {
    if (!session.get()) return;
    api<StaffProfile>("GET", "/v1/staff/me")
      .then(setStaff, () => session.clear())
      .finally(() => setChecking(false));
  }, []);

  function loggedIn(res: StaffLoginResponse, password: string) {
    session.set(res.accessToken);
    setTemporary(res.staff.mustChangePassword ? password : null);
    setStaff(res.staff);
  }

  async function logout() {
    await api("POST", "/v1/staff/logout").catch(() => undefined);
    session.clear();
    setStaff(null);
    window.location.hash = "";
  }

  // Any page that finds the session ended sends the officer back to login.
  const expired = () => {
    session.clear();
    setStaff(null);
  };

  if (checking) return null;

  const languageButton = (
    <button
      className="link"
      onClick={() => setLang(lang === "fr" ? "en" : "fr")}
    >
      {t.language}
    </button>
  );

  if (!staff)
    return (
      <Login t={t} onLoggedIn={loggedIn} languageButton={languageButton} />
    );
  if (staff.mustChangePassword) {
    return (
      <FirstPassword
        t={t}
        staff={staff}
        temporary={temporary}
        onDone={(updated) => {
          setTemporary(null);
          setStaff(updated);
        }}
      />
    );
  }

  const [section, id] = route;
  const page =
    section === "groups" && id && route[2] === "compliance" ? (
      <Compliance key={id} t={t} groupId={id} staffName={staff.name} />
    ) : section === "groups" && id ? (
      <GroupPage
        key={id}
        t={t}
        groupId={id}
        onExpired={expired}
        pilot={staff.pilot}
        role={staff.role}
      />
    ) : section === "groups" ? (
      <Groups t={t} onExpired={expired} />
    ) : section === "settings" ? (
      <Settings t={t} onExpired={expired} isAdmin={staff.role === "ADMIN"} />
    ) : section === "loans" && id ? (
      <LoanPage key={id} t={t} loanId={id} onExpired={expired} />
    ) : section === "loans" ? (
      <Loans t={t} onExpired={expired} />
    ) : section === "loan-policy" ? (
      <LoanPolicy t={t} onExpired={expired} isAdmin={staff.role === "ADMIN"} />
    ) : section === "records" && id ? (
      <RecordPage key={id} t={t} shareId={id} onExpired={expired} />
    ) : section === "records" ? (
      <Records t={t} onExpired={expired} />
    ) : section === "money" ? (
      <Money t={t} onExpired={expired} />
    ) : section === "savings" ? (
      <Savings t={t} onExpired={expired} isAdmin={staff.role === "ADMIN"} />
    ) : section === "analytics" ? (
      <Analytics t={t} onExpired={expired} />
    ) : section === "members" ? (
      <Members t={t} onExpired={expired} />
    ) : section === "activity" ? (
      <Activity t={t} onExpired={expired} />
    ) : section === "team" && staff.role === "ADMIN" ? (
      <Team t={t} onExpired={expired} />
    ) : (
      <Overview t={t} onExpired={expired} />
    );

  const link = (href: string, on: boolean, icon: IconName, label: string, count = 0) => (
    <a href={href} className={on ? "on" : ""}>
      <Icon name={icon} />
      {label}
      {count > 0 ? <span className="count">{count}</span> : null}
    </a>
  );

  return (
    <div className="shell">
      <aside className="side">
        <a href="#/" className="brand">
          <strong>Novi</strong>
          <span>
            {t.console} · {staff.mfi.name}
          </span>
        </a>
        <nav>
          {link("#/", !section, "home", t.overview, counts.toDo)}
          {link("#/groups", section === "groups", "groups", t.groupsNav, counts.groups)}
          {link("#/loans", section === "loans" || section === "loan-policy", "bank", t.loansNav, counts.loans)}
          {link("#/money", section === "money", "coin", t.moneyNav, counts.money)}
          {link("#/savings", section === "savings", "hand", t.savingsNav, counts.savings)}
          {link("#/members", section === "members" || section === "records", "user", t.membersNav)}
          {link("#/analytics", section === "analytics", "chart", t.analytics)}
          {link("#/settings", section === "settings" || section === "team" || section === "activity", "sliders", t.settings)}
        </nav>
        <div className="who">
          <strong>{staff.name}</strong>
          <span>{t.roles[staff.role]}</span>
          <div className="row">
            {languageButton}
            <button className="link" onClick={() => void logout()}>
              {t.logout}
            </button>
          </div>
        </div>
      </aside>
      <main>{page}</main>
    </div>
  );
}
