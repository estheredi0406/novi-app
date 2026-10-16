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