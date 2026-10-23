// 15000 -> "15 000 FCFA", the way amounts are written in Togo.
export const fcfa = (amount: number) => `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;

// "2026-10-23..." -> "23/10/2026"
export const day = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
