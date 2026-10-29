import type { StaffCredentials, StaffMember, StaffRole } from "@novi/shared";
import { type FormEvent, useState } from "react";
import { ApiFailure, api } from "../api";
import type { Text } from "../text";
import { useLoad } from "../useLoad";

// The MFI's team (D81): its administrators add officers, deactivate those
// who leave, and reset a lost access, without anyone running a command on
// the server. Every action is written to the Journal. The temporary password
// and the authenticator code are shown once, to be handed over in person.
export function Team({ t, onExpired }: { t: Text; onExpired: () => void }) {
  const { data, failed, reload } = useLoad(() => api<StaffMember[]>("GET", "/v1/console/team"), onExpired);
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<StaffCredentials | null>(null);
  const [leaving, setLeaving] = useState<StaffMember | null>(null);
  const [error, setError] = useState<string | null>(null);

  const message = (err: unknown) => {
    const key = err instanceof ApiFailure ? err.code : "default";
    return t.errors[key as keyof typeof t.errors] ?? t.errors.default;
  };

  async function act(path: string) {
    setError(null);
    try {
      await api("POST", path);
      reload();
    } catch (err) {
      setError(message(err));
    }
  }

  async function reset(member: StaffMember) {
    if (!window.confirm(t.resetConfirm(member.name))) return;
    setError(null);
    try {
      setShown(await api<StaffCredentials>("POST", `/v1/console/team/${member.id}/reset`));
      reload();
    } catch (err) {
      setError(message(err));
    }
  }

  if (failed) return <p className="error">{t.errors.ADMIN_ONLY}</p>;
  if (!data) return null;

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : t.teamNever;

  return (
    <>
      <div className="team-head">
        <div>
          <h1>{t.team}</h1>
          <p className="muted">{t.teamLede}</p>
        </div>
        <button className="primary" onClick={() => setAdding(true)}>
          {t.teamAdd}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <table className="team">
        <thead>
          <tr>
            <th>{t.teamAgent}</th>
            <th>{t.teamRole}</th>
            <th>{t.teamLastLogin}</th>
            <th>{t.teamState}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.map((m) => (
            <tr key={m.id} className={m.state === "DISABLED" ? "off" : undefined}>
              <td>
                <strong>{m.name}</strong> {m.isYou ? <span className="muted">{t.teamYou}</span> : null}
                <div className="muted small">{m.email}</div>
              </td>
              <td>{t.roles[m.role]}</td>
              <td className="muted">{when(m.lastLoginAt)}</td>
              <td>
                <span className={`chip chip-${m.state.toLowerCase()}`}>{t.states[m.state]}</span>
              </td>
              <td className="team-actions">
                {m.isYou ? null : m.state === "DISABLED" ? (
                  <button className="ghost" onClick={() => void act(`/v1/console/team/${m.id}/reactivate`)}>
                    {t.teamReactivate}
                  </button>
                ) : (
                  <>
                    <button className="ghost" onClick={() => void reset(m)}>
                      {t.teamReset}
                    </button>
                    <button className="ghost danger" onClick={() => setLeaving(m)}>
                      {t.teamDeactivate}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">{t.teamAdminOnly}</p>

      {adding ? (
        <AddOfficer
          t={t}
          onCancel={() => setAdding(false)}
          onAdded={(created) => {
            setAdding(false);
            setShown(created);
            reload();
          }}
          message={message}
        />
      ) : null}

      {shown ? <Credentials t={t} credentials={shown} onClose={() => setShown(null)} /> : null}

      {leaving ? (
        <div className="veil" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>{t.deactivateTitle(leaving.name)}</h2>
            <p>{t.deactivateBody(leaving.name)}</p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setLeaving(null)}>
                {t.cancel}
              </button>
              <button
                className="primary danger-fill"
                onClick={() => {
                  const id = leaving.id;
                  setLeaving(null);
                  void act(`/v1/console/team/${id}/deactivate`);
                }}
              >
                {t.teamDeactivate}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function AddOfficer({
  t,
  onCancel,
  onAdded,
  message,
}: {
  t: Text;
  onCancel: () => void;
  onAdded: (created: StaffCredentials) => void;
  message: (err: unknown) => string;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("OFFICER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onAdded(await api<StaffCredentials>("POST", "/v1/console/team", { name, email, role }));
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <div className="veil" role="dialog" aria-modal="true">
      <form className="modal" onSubmit={(e) => void submit(e)}>
        <h2>{t.addTitle}</h2>
        <label>
          {t.fullName}
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} />
        </label>
        <label>
          {t.loginEmail}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <div className="field">
          <span>{t.teamRole}</span>
          <div className="seg" role="radiogroup">
            {(["OFFICER", "ADMIN"] as const).map((r) => (
              <button
                type="button"
                key={r}
                role="radio"
                aria-checked={role === r}
                className={role === r ? "on" : undefined}
                onClick={() => setRole(r)}
              >
                {t.roles[r]}
              </button>
            ))}
          </div>
          <small className="muted">{t.roleHint}</small>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            {t.cancel}
          </button>
          <button className="primary" disabled={busy}>
            {t.createAccess}
          </button>
        </div>
      </form>
    </div>
  );
}

function Credentials({ t, credentials, onClose }: { t: Text; credentials: StaffCredentials; onClose: () => void }) {
  const first = credentials.member.name.split(" ")[0] ?? credentials.member.name;
  return (
    <div className="veil" role="dialog" aria-modal="true">
      <div className="modal wide">
        <h2>{t.accessOf(credentials.member.name)}</h2>
        <p className="warn">{t.onceWarning(first)}</p>
        <div className="creds">
          {/* The API draws the QR code itself (an SVG of the authenticator link). */}
          <div className="qr" dangerouslySetInnerHTML={{ __html: credentials.qrSvg }} />
          <div className="creds-steps">
            <div>
              <span className="muted small strong">{t.step1}</span>
              <div>{t.step1Body}</div>
              <div className="muted small">
                {t.setupKey} : <code>{credentials.setupKey}</code>
              </div>
            </div>
            <div>
              <span className="muted small strong">{t.step2}</span>
              <div className="temp">{credentials.password}</div>
            </div>
            <div>
              <span className="muted small strong">{t.step3}</span>
              <div>{t.step3Body(first)}</div>
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            {t.doneClose}
          </button>
        </div>
      </div>
    </div>
  );
}
