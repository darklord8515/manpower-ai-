import { describe, expect, it } from "vitest";
import { companyDate, companyHour, firstName, greeting, periodFor } from "./greeting";

// Gulf Standard Time is UTC+4 all year, so 08:00 UTC is 12:00 in Dubai.
const at = (utc: string) => new Date(`2026-11-05T${utc}:00Z`);

describe("periodFor (Dubai time)", () => {
  it.each([
    ["00:59", "evening"], // 04:59
    ["01:00", "morning"], // 05:00
    ["07:59", "morning"], // 11:59
    ["08:00", "afternoon"], // 12:00
    ["12:59", "afternoon"], // 16:59
    ["13:00", "evening"], // 17:00
    ["20:00", "evening"], // 00:00 next day
  ])("%s UTC is %s in Dubai", (utc, expected) => {
    expect(periodFor(at(utc))).toBe(expected);
  });

  it("uses Dubai time, not the visitor's clock", () => {
    // 23:30 UTC on 4 Nov is already 03:30 on 5 Nov in Dubai: still evening, not "afternoon".
    expect(periodFor(new Date("2026-11-04T23:30:00Z"))).toBe("evening");
    expect(companyHour(new Date("2026-11-04T23:30:00Z"))).toBe(3);
  });
});

describe("greeting", () => {
  it("greets by first name only", () => {
    expect(greeting("morning", "Noura Demo")).toBe("Good morning, Noura");
    expect(greeting("evening", "Layla Demo")).toBe("Good evening, Layla");
    expect(greeting("morning", "Mr Sanjay")).toBe("Good morning, Mr Sanjay");
    expect(greeting("morning", "Mr. Imtiyaz Khan")).toBe("Good morning, Mr. Imtiyaz");
    expect(firstName("  Priya   Demo ")).toBe("Priya");
    expect(firstName("Madonna")).toBe("Madonna");
  });
});

describe("companyDate", () => {
  it("writes the Dubai date in full", () => {
    expect(companyDate(at("08:00"))).toBe("Thursday, 5 November 2026");
    expect(companyDate(new Date("2026-11-04T21:00:00Z"))).toBe("Thursday, 5 November 2026");
  });
});
