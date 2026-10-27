import type { ConsoleActivity } from "@novi/shared";
import { api } from "../api";
import type { Text } from "../text";
import { useLoad } from "../useLoad";

// Who did what, and when (D67): every validation, release, retry and opened
// ACEV by this MFI's officers. The kind of trail an auditor asks for.
export function Activity({ t, onExpired }: { t: Text; onExpired: () => void }) {
  const { data, failed } = useLoad(() => api<ConsoleActivity[]>("GET", "/v1/console/activity"), onExpired);
  if (failed) return <p className="error">{t.errors.default}</p>;
  if (!data) return null;

  const when = (iso: string) =>
    new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <>
      <h1>{t.activityTitle}</h1>
      {data.length === 0 ? (
        <p className="calm">{t.activityEmpty}</p>
      ) : (
        <ul className="log">
          {data.map((entry) => (
            <li key={`${entry.at}-${entry.action}`}>
              <time>{when(entry.at)}</time>
              <span>
                <strong>{entry.staffName}</strong> {t.actions[entry.action]}
                {entry.detail ? ` · ${entry.detail}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
