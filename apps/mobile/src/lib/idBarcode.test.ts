import { describe, expect, it } from "vitest";
import { describeBarcode } from "./idBarcode";

// D35: describes the layout of an ID card's barcode without keeping its data.
describe("reading the shape of an ID barcode", () => {
  it("finds the NIU-like digit run, the date and the names in a pipe-separated payload", () => {
    const shape = describeBarcode("0000000000001|MENSAH|AKOSSIWA AFI|12/03/1984|F");
    expect(shape.longestDigitRun).toBe(13);
    expect(shape.dateLike).toBe(1);
    expect(shape.capitalWords).toBe(3);
    expect(shape.separators).toEqual([{ symbol: "|", count: 4 }]);
    expect(shape.readableShare).toBe(100);
    expect(shape.hints).toEqual([]);
  });

  it("recognises a passport-style machine-readable zone", () => {
    expect(describeBarcode("P<TGOMENSAH<<AKOSSIWA<AFI<<<<").hints).toContain("idScan.hintMrz");
  });

  it("flags data that is mostly unreadable bytes as encoded", () => {
    expect(describeBarcode("\u0001\u0002\u0003\u0004ab").hints).toContain("idScan.hintEncoded");
  });

  it("handles an empty read without dividing by zero", () => {
    const shape = describeBarcode("");
    expect(shape).toMatchObject({ length: 0, readableShare: 0, lines: 0, longestDigitRun: 0 });
  });
});
