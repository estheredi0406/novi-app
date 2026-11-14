import type { ConsoleMember, ConsoleMemberSeat } from "@novi/shared";
import { type FormEvent, useState } from "react";
import { api, ApiFailure } from "../api";
import { fcfa } from "../format";
import type { Text } from "../text";

const PHONE = /^\+228\d{8}$/;

// A member at the counter (D69): find her by phone number, then handle a death,
// a member leaving, a lost phone, or a new organiser. The money does not move.
// Everything is logged.
export function Members({ t, onExpired }: { t: Text; onExpired: () => void }) {
  const [phone, setPhone] = useState("+228");
  const [member, setMember] = useState<ConsoleMember | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errorText = (err: unknown) => {
    if (err instanceof ApiFailure && err.status === 401) {
      onExpired();
      return null;
    }
    const code = err instanceof ApiFailure ? err.code : "default";
    // On this page the only thing typed is a phone number.
    if (code === "VALIDATION_FAILED") return t.errors.phoneInvalid;
    return (t.errors as Record<string, string>)[code] ?? t.errors.default;
  };

  async function run(action: () => Promise<ConsoleMember>, done?: string) {
    setBusy(true);
    setMessage(null);
    try {
      setMember(await action());
      if (done) setMessage(done);
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    const typed = phone.replace(/\s/g, "");
    setMember(null);
    void run(() => api<ConsoleMember>("GET", `/v1/console/members?phone=${encodeURIComponent(typed)}`));
  }

  function recordDeath(m: ConsoleMember, seat: ConsoleMemberSeat) {
    let payoutPhone: string | undefined;
    if (!m.nextOfKin) {
      const typed = window.prompt(t.deathAskPhone, "+228")?.replace(/\s/g, "");
      if (!typed) return;
      if (!PHONE.test(typed)) return setMessage(t.errors.phoneInvalid);
      payoutPhone = typed;
    }
    const kin = m.nextOfKin ? `${m.nextOfKin.name} (${m.nextOfKin.phone})` : (payoutPhone as string);
    if (!window.confirm(t.deathConfirm(m.legalName, kin))) return;
    void run(
      () =>
        api<ConsoleMember>("POST", `/v1/console/members/${m.userId}/exit`, {
          groupId: seat.groupId,
          reason: "DEATH",
          ...(payoutPhone ? { payoutPhone } : {}),
        }),
      t.done,
    );
  }

  function recordLeft(m: ConsoleMember, seat: ConsoleMemberSeat) {
    if (!window.confirm(t.leftConfirm(m.legalName))) return;
    void run(
      () => api<ConsoleMember>("POST", `/v1/console/members/${m.userId}/exit`, { groupId: seat.groupId, reason: "LEFT" }),
      t.done,
    );
  }

  function changePhone(m: ConsoleMember) {
    const typed = window.prompt(t.phoneAsk, "+228")?.replace(/\s/g, "");
    if (!typed) return;
    if (!PHONE.test(typed)) return setMessage(t.errors.phoneInvalid);
    if (!window.confirm(t.phoneConfirm(typed))) return;
    void run(async () => {
      const updated = await api<ConsoleMember>("POST", `/v1/console/members/${m.userId}/phone`, { phone: typed });
      setPhone(updated.phone);
      return updated;
    }, t.done);
  }

  function makeOrganiser(m: ConsoleMember, seat: ConsoleMemberSeat) {
    if (!window.confirm(t.organiserConfirm(m.legalName, seat.groupName))) return;
    void run(
      () => api<ConsoleMember>("POST", `/v1/console/groups/${seat.groupId}/organiser`, { userId: m.userId }),
      t.done,
    );
  }

  return (
    <>
      <h1>{t.membersTitle}</h1>
      <p className="calm">{t.memberSearchHint}</p>
      <form className="member-search" onSubmit={search}>
        <label>
          {t.phoneLabel}
          <input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </label>
        <button className="primary" disabled={busy}>
          {t.find}
        </button>
      </form>
      {message && <p className={member && message === t.done ? "calm" : "error"}>{message}</p>}

      {member && (
        <section className="member">
          <div className="member-head">
            <div>
              <h2>{member.legalName}</h2>
              <span className="muted">{member.phone}</span>
            </div>
            {!member.closed && (
              <button className="link" disabled={busy} onClick={() => changePhone(member)}>
                {t.changePhone}
              </button>
            )}
          </div>
          {member.closed && <p className="chip chip-failed">{t.closed}</p>}

          <div className="member-facts">
            <div>
              <span>{t.kinTitle}</span>
              <strong>
                {member.nextOfKin
                  ? `${member.nextOfKin.name} · ${member.nextOfKin.relation} · ${member.nextOfKin.phone}`
                  : t.kinNone}
              </strong>
            </div>
            <div>
              <span>{member.owedFcfa > 0 ? t.owed : t.owesNothing}</span>
              <strong>{fcfa(member.owedFcfa)}</strong>
            </div>
          </div>

          <h2>{t.seatsTitle}</h2>
          <ul className="attention">
            {member.seats.map((seat) => {
              const running = seat.groupState === "ACTIVE" && !seat.exitReason && !member.closed;
              return (
                <li key={seat.groupId} className={`flag ${seat.exitReason ? "flag-held" : ""}`}>
                  <div>
                    <a href={`#/groups/${seat.groupId}`} className="flag-title">
                      {seat.groupName}
                    </a>
                    <span className="flag-meta">
                      {[
                        seat.role === "ORGANISER" ? t.organiser : null,
                        seat.payoutPosition ? t.position(seat.payoutPosition) : null,
                        seat.potReceived ? t.potReceived : t.potNotYet,
                        seat.exitReason ? t.exited[seat.exitReason] : null,
                        seat.exitPayoutPhone ? t.paidTo(seat.exitPayoutPhone) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  {running && (
                    <div className="member-actions">
                      {seat.role !== "ORGANISER" && (
                        <button className="link" disabled={busy} onClick={() => makeOrganiser(member, seat)}>
                          {t.makeOrganiser}
                        </button>
                      )}
                      <button className="link" disabled={busy} onClick={() => recordLeft(member, seat)}>
                        {t.recordLeft}
                      </button>
                      <button className="link danger" disabled={busy} onClick={() => recordDeath(member, seat)}>
                        {t.recordDeath}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
