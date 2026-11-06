import { describe, expect, it } from "vitest";
import { emptyForm, hasErrors, toPayload, validate, type RequestForm } from "./new-request";

const valid = (): RequestForm => ({
  project: "RAK-07",
  needed_from: "2027-02-12",
  needed_until: "2027-12-31",
  priority: "2",
  note: "  Second tower  ",
  lines: [{ id: 1, trade: "steel_fixer", headcount: "7", min_level: "3" }],
});

describe("validate", () => {
  it("accepts a complete request", () => {
    expect(hasErrors(validate(valid()))).toBe(false);
  });

  it("names every missing thing on an empty form", () => {
    const errors = validate(emptyForm());
    expect(errors.project).toBe("Choose the project the workers are for.");
    expect(errors.dates).toBe("Choose the date the workers are needed from.");
    expect(errors.line[1]).toEqual({
      trade: "Choose a trade.",
      headcount: "Enter a whole number from 1 to 500.",
    });
    expect(hasErrors(errors)).toBe(true);
  });

  it("rejects an end date before the start date, but allows no end date", () => {
    expect(validate({ ...valid(), needed_until: "2027-01-01" }).dates).toBe(
      "The end date must not be before the start date.",
    );
    expect(validate({ ...valid(), needed_until: "" }).dates).toBeUndefined();
  });

  it.each(["0", "501", "2.5", "abc", ""])("rejects %j as a headcount", (headcount) => {
    const form = valid();
    form.lines[0].headcount = headcount;
    expect(validate(form).line[1]?.headcount).toBe("Enter a whole number from 1 to 500.");
  });

  it("rejects the same trade twice", () => {
    const form = valid();
    form.lines.push({ id: 2, trade: "steel_fixer", headcount: "2", min_level: "" });
    expect(validate(form).line[2]?.trade).toBe("This trade is already in the list.");
    expect(validate(form).line[1]).toBeUndefined();
  });
});

describe("toPayload", () => {
  it("turns the text fields into what the API expects", () => {
    expect(toPayload(valid())).toEqual({
      project: "RAK-07",
      needed_from: "2027-02-12",
      needed_until: "2027-12-31",
      priority: 2,
      source_text: "Second tower",
      lines: [{ trade: "steel_fixer", headcount: 7, min_level: 3 }],
    });
  });

  it("sends null for what was left empty", () => {
    const form = valid();
    form.needed_until = "";
    form.note = "   ";
    form.lines[0].min_level = "";
    const payload = toPayload(form);
    expect(payload.needed_until).toBeNull();
    expect(payload.source_text).toBeNull();
    expect(payload.lines[0].min_level).toBeNull();
  });
});
