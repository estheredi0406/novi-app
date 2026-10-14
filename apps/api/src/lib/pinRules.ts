// PINs people choose most often. 2580 runs straight down the middle of a
// phone keypad; 1004 and 2000 are common date-like choices.
const COMMON_PINS = new Set(["1212", "1122", "1010", "0101", "1313", "2323", "2580", "0852", "1004", "2000"]);

// True when a 4-digit PIN is too easy to guess (D16): one digit repeated,
// a straight sequence up or down, or one of the most common choices.
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1{3}$/.test(pin)) return true;

  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((digit, i) => digit - (digits[i] ?? 0));
  if (steps.every((step) => step === 1) || steps.every((step) => step === -1)) return true;

  return COMMON_PINS.has(pin);
}