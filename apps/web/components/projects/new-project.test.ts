import { describe, expect, it } from "vitest";
import { emptyForm, hasErrors, toPayload, validate, type ProjectForm } from "./new-project";

const good = (): ProjectForm => ({
  name: "Marina Towers",
  starts_on: "2027-04-01",
  ends_on: "2028-03-31",
  outdoor: true,
  lines: [
    { id: 1, trade: "mason", headcount: "12" },
    { id: 2, trade: "carpenter", headcount: "6" },
  ],
});

describe("validate", () => {
  it("accepts a complete form and turns it into the API's shape", () => {
    expect(hasErrors(validate(good()))).toBe(false);
    expect(toPayload({ ...good(), name: "  Marina Towers " })).toEqual({
      name: "Marina Towers",
      starts_on: "2027-04-01",
      ends_on: "2028-03-31",
      outdoor: true,
      lines: [
        { trade: "mason", headcount: 12 },
        { trade: "carpenter", headcount: 6 },
      ],
    });
  });

  it("explains every mistake on an empty form", () => {
    const errors = validate(emptyForm());
    expect(errors.name).toMatch(/at least 3/);
    expect(errors.dates).toBe("Choose a start and an end date.");
    expect(errors.line[1]).toEqual({
      trade: "Choose a trade.",
      headcount: "Enter a whole number from 1 to 500.",
    });
  });

  it("checks the dates against each other", () => {
    const errors = validate({ ...good(), starts_on: "2028-04-01" });
    expect(errors.dates).toBe("The end date must not be before the start date.");
  });

  it("refuses a trade twice, and headcounts that are not whole numbers from 1 to 500", () => {
    const form = good();
    form.lines = [
      { id: 1, trade: "mason", headcount: "0" },
      { id: 2, trade: "mason", headcount: "2.5" },
      { id: 3, trade: "painter", headcount: "501" },
      { id: 4, trade: "plumber", headcount: "abc" },
    ];
    const { line } = validate(form);
    expect(line[1]?.headcount).toBeDefined();
    expect(line[2]).toEqual({
      trade: "This trade is already in the list.",
      headcount: "Enter a whole number from 1 to 500.",
    });
    expect(line[3]?.headcount).toBeDefined();
    expect(line[4]?.headcount).toBeDefined();
  });

  it("needs at least one trade", () => {
    expect(validate({ ...good(), lines: [] }).lines).toBe("Add at least one trade.");
  });
});
