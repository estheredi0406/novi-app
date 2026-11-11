import type { Text } from "../text";
import { Team } from "./Team";

// "Réglages" (board 16, D116): what is set once and rarely changed. For now:
// the log and the shared records for everyone, and for an administrator the
// team, the payment account and the automatic release (the Team page).
export function Settings({ t, onExpired, isAdmin }: { t: Text; onExpired: () => void; isAdmin: boolean }) {
  return (
    <>
      <div className="page-head">
        <h1>{t.settingsTitle}</h1>
      </div>
      <div className="settings-cards">
        <a href="#/activity">
          <strong>{t.journalCard}</strong>
          <span className="muted small">{t.journalHint}</span>
        </a>
        <a href="#/records">
          <strong>{t.recordsCard}</strong>
          <span className="muted small">{t.records}</span>
        </a>
      </div>
      {isAdmin ? <Team t={t} onExpired={onExpired} /> : null}
    </>
  );
}
