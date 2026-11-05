import { describe, expect, it } from "vitest";
import { formatAed, formatDate, formatInt, formatPercent } from "./format";

describe("formatters", () => {
  it("formats dates as 5 Nov 2026 without shifting by time zone", () => {
    expect(formatDate("2026-11-05")).toBe("5 Nov 2026");
    expect(formatDate("2027-02-12T23:30:00Z")).toBe("12 Feb 2027");
    expect(formatDate("2026-12-01")).toBe("1 Dec 2026");
  });

  it("rejects a value that is not an ISO date", () => {
    expect(() => formatDate("5 Nov 2026")).toThrow();
  });

  it("formats numbers with thousands separators and one-decimal percentages", () => {
    expect(formatInt(3412)).toBe("3,412");
    expect(formatPercent(94.66)).toBe("94.7%");
    expect(formatAed(1250)).toBe("AED 1,250");
  });
});
