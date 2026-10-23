import type { StaffLoginResponse, StaffProfile } from "@novi/shared";
import { useEffect, useState } from "react";
import { api, session } from "./api";
import { GroupPage } from "./pages/GroupPage";
import { Login } from "./pages/Login";
import { Overview } from "./pages/Overview";
import { RecordPage, Records } from "./pages/Records";
import { type Lang, text } from "./text";

// The console's pages, read from the address bar after "#", so the browser's
// back button works without a routing library: #/, #/groups/<id>,
// #/records, #/records/<id>.
function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function App() {
  const [lang, setLang] = useState<Lang>("fr");
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [checking, setChecking] = useState(Boolean(session.get()));
  const route = useRoute();
  const t = text[lang];

  // A token from earlier in this tab: check it is still valid.
  useEffect(() => {
    if (!session.get()) return;
    api<StaffProfile>("GET", "/v1/staff/me")
      .then(setStaff, () => session.clear())
      .finally(() => setChecking(false));
  }, []);

  function loggedIn(res: StaffLoginResponse) {
    session.set(res.accessToken);
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
    <button className="link" onClick={() => setLang(lang === "fr" ? "en" : "fr")}>
      {t.language}
    </button>
  );

  if (!staff) return <Login t={t} onLoggedIn={loggedIn} languageButton={languageButton} />;

  const [section, id] = route;
  const page =
    section === "groups" && id ? (
      <GroupPage key={id} t={t} groupId={id} onExpired={expired} />
    ) : section === "records" && id ? (
      <RecordPage key={id} t={t} shareId={id} onExpired={expired} />
    ) : section === "records" ? (
      <Records t={t} onExpired={expired} />
    ) : (
      <Overview t={t} onExpired={expired} />
    );

  return (
    <div className="shell">
      <header className="top">
        <div className="top-inner">
          <a href="#/" className="wordmark">
            Novi <span>{t.console}</span>
          </a>
          <nav>
            <a href="#/" className={section !== "records" ? "on" : ""}>
              {t.overview}
            </a>
            <a href="#/records" className={section === "records" ? "on" : ""}>
              {t.records}
            </a>
          </nav>
          <div className="who">
            <strong>{staff.mfi.name}</strong>
            <span>{staff.name}</span>
            {languageButton}
            <button className="link" onClick={() => void logout()}>
              {t.logout}
            </button>
          </div>
        </div>
        <div className="band" aria-hidden="true" />
      </header>
      <main>{page}</main>
    </div>
  );
}
