// "+22890123456" becomes "+228 90 12 34 56", the way Togolese numbers are usually written.
export function formatPhone(phone: string): string {
  const digits = phone.replace("+228", "");
  return `+228 ${digits.match(/.{1,2}/g)?.join(" ") ?? digits}`;
}

// 75 becomes "1:15", for countdowns.
export function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
// 50000 becomes "50 000 FCFA", with the space French and Togolese usage put
// between thousands. Written by hand so every phone shows the same thing.
export function formatFcfa(amount: number): string {
  return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;
}

// "2026-10-23" becomes "23/10/2026", the way dates are written in Togo.
export function formatDay(isoDay: string): string {
  const [year, month, day] = isoDay.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

// Whole days from today (Lomé time is GMT all year) to a "YYYY-MM-DD" date.
export function daysUntil(isoDay: string, now = new Date()): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(`${isoDay.slice(0, 10)}T00:00:00Z`) - today) / 86_400_000);
}
