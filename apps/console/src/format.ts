// 15000 -> "15 000 FCFA", the way amounts are written in Togo.
export const fcfa = (amount: number) => `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;

// "2026-10-23..." -> "23/10/2026"
export const day = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

// +22890000095 reads as +228 90 00 00 95.
export function spacedPhone(phone: string): string {
  const m = /^\+(228|229|250)(\d+)$/.exec(phone);
  return m?.[2] ? `+${m[1]} ${m[2].replace(/(\d{2})(?=\d)/g, "$1 ")}` : phone;
}
