// Describes the shape of what an ID card's barcode holds, without keeping or
// showing any of it (development only, D35). The result says how the data is
// laid out, so the sign-up can later read it, while the card holder's NIU,
// name and date of birth never leave the phone, and are not even displayed.

export type BarcodeShape = {
  length: number; // characters read
  readableShare: number; // 0 to 100: letters, digits, spaces and common punctuation
  lines: number;
  separators: { symbol: string; count: number }[]; // only those that appear
  longestDigitRun: number; // an NIU is a long run of digits
  dateLike: number; // how many pieces look like a date
  capitalWords: number; // names are often printed in capitals
  hints: string[]; // translation keys for recognised layouts
};

const SEPARATORS = ["|", ";", ",", "\t", "@", "^", "<", "#", "*"];

// Common ways a date is written on ID documents: 12/03/1984, 12.03.1984,
// 1984-03-12, 19840312.
const DATE_PATTERNS = [/\b\d{2}[/.-]\d{2}[/.-]\d{4}\b/g, /\b\d{4}-\d{2}-\d{2}\b/g, /\b(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/g];

export function describeBarcode(data: string): BarcodeShape {
  const length = data.length;
  const readable = data.match(/[\p{L}\p{N} .,;:'/|()<>@#*^_+-]/gu)?.length ?? 0;
  const digitRuns = data.match(/\d+/g) ?? [];

  const hints: string[] = [];
  if (data.startsWith("@") && data.includes("ANSI")) hints.push("idScan.hintAamva");
  if (data.includes("<<")) hints.push("idScan.hintMrz");
  if (length > 0 && readable / length < 0.6) hints.push("idScan.hintEncoded");

  return {
    length,
    readableShare: length === 0 ? 0 : Math.round((readable / length) * 100),
    lines: length === 0 ? 0 : data.split(/\r\n|\r|\n/).length,
    separators: SEPARATORS.map((symbol) => ({ symbol, count: data.split(symbol).length - 1 })).filter((s) => s.count > 0),
    longestDigitRun: digitRuns.reduce((longest, run) => Math.max(longest, run.length), 0),
    dateLike: DATE_PATTERNS.reduce((sum, pattern) => sum + (data.match(pattern)?.length ?? 0), 0),
    capitalWords: data.match(/\b\p{Lu}{2,}\b/gu)?.length ?? 0,
    hints,
  };
}
