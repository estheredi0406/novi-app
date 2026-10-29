import type { StaffLoginResponse } from "@novi/shared";
import { type FormEvent, type ReactNode, useState } from "react";
import { ApiFailure, api } from "../api";
import type { Text } from "../text";

// Email, password and the authenticator app's code, all at once (D52).
export function Login({
  t,
  onLoggedIn,
  languageButton,
}: {
  t: Text;
  onLoggedIn: (res: StaffLoginResponse, password: string) => void;
  languageButton: ReactNode;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLoggedIn(await api<StaffLoginResponse>("POST", "/v1/staff/login", { email, password, code }), password);
    } catch (err) {
      const key = err instanceof ApiFailure ? err.code : "default";
      setError(t.errors[key as keyof typeof t.errors] ?? t.errors.default);
      setCode("");
    } finally {
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
        <label>
          {t.email}
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          {t.password}
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <label>
          {t.code}
          <input
            className="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            required
          />
          <small>{t.codeHint}</small>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {t.login}
        </button>
        <div className="login-foot">{languageButton}</div>
      </form>
    </div>
  );
}
