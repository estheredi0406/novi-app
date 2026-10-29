import type { StaffProfile } from "@novi/shared";
import { type FormEvent, useState } from "react";
import { ApiFailure, api } from "../api";
import type { Text } from "../text";

// D81: the first login, with the temporary password an administrator handed
// over. The console stays closed until the officer chooses her own.
export function FirstPassword({
  t,
  staff,
  temporary,
  onDone,
}: {
  t: Text;
  staff: StaffProfile;
  temporary: string | null; // typed at login a moment ago; asked again after a reload
  onDone: (staff: StaffProfile) => void;
}) {
  const [current, setCurrent] = useState(temporary ?? "");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (next !== again) {
      setError(t.passwordsDiffer);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(await api<StaffProfile>("POST", "/v1/staff/password", { current, next }));
    } catch (err) {
      const key = err instanceof ApiFailure ? err.code : "default";
      setError(t.errors[key as keyof typeof t.errors] ?? t.errors.default);
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="band" aria-hidden="true" />
      <form className="login-card" onSubmit={(e) => void submit(e)}>
        <p className="wordmark dark">
          Novi <span>{t.console}</span>
        </p>
        <h1 style={{ fontSize: 24, margin: 0 }}>{t.welcome(staff.name.split(" ")[0] ?? staff.name)}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {t.choosePassword}
        </p>
        {temporary ? null : (
          <label>
            {t.temporaryPassword}
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </label>
        )}
        <label>
          {t.newPassword}
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={12} required />
          <small>{t.newPasswordHint}</small>
        </label>
        <label>
          {t.repeatPassword}
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {t.saveContinue}
        </button>
      </form>
    </div>
  );
}
