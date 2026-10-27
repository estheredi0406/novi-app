import type { TFunction } from "i18next";

// How a meeting's date and time are shown: in the phone's own time zone
// (Lomé is on GMT), with the weekday, as people say it at the market.
export function meetingWhen(iso: string, language: string): string {
  const date = new Date(iso);
  const locale = language === "en" ? "en-GB" : "fr-FR";
  const day = date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${time}`;
}

// "Opens in 2 h 15", "Opens in 25 min": the room opens 10 minutes before.
export function opensIn(t: TFunction, iso: string, now = new Date()): string {
  const minutes = Math.max(0, Math.round((new Date(iso).getTime() - 10 * 60_000 - now.getTime()) / 60_000));
  if (minutes >= 24 * 60) return t("meetings.opensInDays", { count: Math.round(minutes / (24 * 60)) });
  if (minutes >= 60) return t("meetings.opensInHours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  return t("meetings.opensInMinutes", { count: minutes });
}
