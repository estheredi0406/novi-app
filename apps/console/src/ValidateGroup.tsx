import { useState } from "react";
import { api } from "./api";
import type { Text } from "./text";

// D133: a waiting group can be validated from Aujourd'hui, the "À valider" tab
// or its own page (D66). Refusing needs a reason, which the organiser reads.
export function ValidateGroup({
  t,
  group,
  onDone,
}: {
  t: Text;
  group: { id: string; name: string };
  onDone: (approved: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function decide(approve: boolean) {
    let body: { reason: string } | undefined;
    if (approve) {
      if (!window.confirm(t.approveConfirm(group.name))) return;
    } else {
      const reason = window.prompt(t.declineAsk)?.trim();
      if (!reason || reason.length < 3) return;
      body = { reason };
    }
    setBusy(true);
    try {
      await api("POST", `/v1/console/groups/${group.id}/${approve ? "approve" : "decline"}`, body);
      onDone(approve);
    } catch {
      window.alert(t.errors.default);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="validate-actions" onClick={(e) => e.stopPropagation()}>
      <button className="primary small" disabled={busy} onClick={() => void decide(true)}>
        {t.approve}
      </button>
      <button className="link" disabled={busy} onClick={() => void decide(false)}>
        {t.decline}
      </button>
    </span>
  );
}
