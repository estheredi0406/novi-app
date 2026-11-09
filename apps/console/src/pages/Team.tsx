import type { ConsoleOverview, ConsolePaymentAccount, StaffCredentials, StaffMember, StaffRole } from "@novi/shared";
import { type FormEvent, useState } from "react";
import { ApiFailure, api } from "../api";
import { fcfa } from "../format";
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

      <PaymentAccount t={t} message={message} />
      <AutoRelease t={t} message={message} />

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

// D105: the amount up to which a full pot leaves on its day without an
// officer; above it, two officers. Administrators only, like the team.
function AutoRelease({ t, message }: { t: Text; message: (err: unknown) => string }) {
  const { data, reload } = useLoad(() => api<ConsoleOverview>("GET", "/v1/console/overview"), () => undefined);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState<string | null>(null);
  if (!data) return null;

  async function save(value: number | null) {
    setNote(null);
    try {
      await api("PUT", "/v1/console/auto-release", { amountFcfa: value });
      setAmount("");
      setNote(t.autoSaved);
      reload();
    } catch (err) {
      setNote(message(err));
    }
  }

  const typed = Number(amount.replace(/\s/g, ""));
  return (
    <section className="queue" style={{ marginTop: 28 }}>
      <div className="queue-head">
        <h2>{t.autoTitle}</h2>
        <strong>{data.autoReleaseFcfa === null ? t.autoOff : t.autoUpTo(fcfa(data.autoReleaseFcfa))}</strong>
      </div>
      <p className="muted" style={{ padding: "0 24px", margin: 0 }}>
        {t.autoLede}
      </p>
      <form
        className="auto-release"
        style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", padding: "16px 24px 22px" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (Number.isInteger(typed) && typed >= 0) void save(typed);
        }}
      >
        <label>
          {t.autoAmount}
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50 000" />
        </label>
        <button className="primary" disabled={amount.trim() === ""}>
          {t.autoSave}
        </button>
        {data.autoReleaseFcfa !== null ? (
          <button type="button" className="ghost" onClick={() => void save(null)}>
            {t.autoTurnOff}
          </button>
        ) : null}
        {note ? <span className="muted small">{note}</span> : null}
      </form>
    </section>
  );
}

// D102: the MFI connects its own FedaPay account. The keys are sent once,
// checked with FedaPay by the server, stored encrypted and never shown again.
function PaymentAccount({ t, message }: { t: Text; message: (err: unknown) => string }) {
  const { data, reload } = useLoad(() => api<ConsolePaymentAccount>("GET", "/v1/console/payment-account"), () => undefined);
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!data) return null;

  async function send(method: "PUT" | "POST", path: string, body?: object) {
    setBusy(true);
    setNote(method === "PUT" && path === "/v1/console/payment-account" ? t.payChecking : null);
    try {
      await api(method, path, body);
      setSecretKey("");
      setWebhookSecret("");
      setNote(null);
      reload();
    } catch (err) {
      setNote(message(err));
    } finally {
      setBusy(false);
    }
  }

  const day = data.connectedAt ? new Date(data.connectedAt).toLocaleDateString("fr-FR") : "";
  const webhookUrl = `${window.location.origin}${data.webhookPath}`;
  const row = { display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" as const, padding: "0 24px 16px" };
  return (
    <section className="queue" style={{ marginTop: 28 }}>
      <div className="queue-head">
        <h2>{t.payTitle}</h2>
        <strong>
          {data.connected ? t.payConnected(data.live ? t.payModeLive : t.payModeSandbox, day) : t.payNotConnected}
        </strong>
      </div>
      <p className="muted" style={{ padding: "0 24px", margin: "0 0 12px" }}>
        {t.payLede}
      </p>
      {!data.connected ? (
        <p className={data.usesDemo ? "muted" : "warn"} style={{ padding: "0 24px", margin: "0 0 12px" }}>
          {data.usesDemo ? t.payDemo : t.payBlocked}
        </p>
      ) : null}

      {data.connected ? (
        <>
          <p className="muted small" style={{ padding: "0 24px", margin: "0 0 4px" }}>
            {t.payWebhook}
          </p>
          <p style={{ padding: "0 24px", margin: "0 0 16px" }}>
            <code>{webhookUrl}</code>
          </p>
          <div style={row}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={data.payoutsViaFedapay}
                disabled={busy}
                onChange={(e) =>
                  void send("PUT", "/v1/console/payment-account/payouts", { fedapay: e.target.checked })
                }
              />
              {t.payPayouts}
            </label>
            <button
              type="button"
              className="ghost danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t.payDisconnectConfirm)) void send("POST", "/v1/console/payment-account/disconnect");
              }}
            >
              {t.payDisconnect}
            </button>
          </div>
          {!data.payoutsViaFedapay ? (
            <p className="muted small" style={{ padding: "0 24px", margin: "0 0 16px" }}>
              {t.payPayoutsOff}
            </p>
          ) : null}
        </>
      ) : (
        <form
          style={{ ...row, paddingBottom: 22 }}
          onSubmit={(e) => {
            e.preventDefault();
            void send("PUT", "/v1/console/payment-account", { secretKey, webhookSecret, live });
          }}
        >
          <label>
            {t.paySecret}
            <input type="password" autoComplete="off" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} required minLength={10} />
          </label>
          <label>
            {t.payWebhookSecret}
            <input type="password" autoComplete="off" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} required minLength={10} />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            {t.payLive}
          </label>
          <button className="primary" disabled={busy}>
            {t.payConnect}
          </button>
        </form>
      )}
      {note ? (
        <p className="muted small" style={{ padding: "0 24px 16px", margin: 0 }}>
          {note}
        </p>
      ) : null}
    </section>
  );
}
