import { describe, expect, it } from "vitest";
import {
  TYPE_LABEL,
  ageText,
  factRows,
  lastSnoozeDay,
  snoozeChoices,
  snoozeProblem,
  tomorrowMorning,
  untilForDay,
} from "./alerts";

const NOW = "2026-11-05T09:00:00+04:00"; // the demo's time: Thursday 5 Nov, 09:00 Gulf

describe("ageText", () => {
  it.each([
    ["2026-11-05T08:30:00+04:00", "just now"],
    ["2026-11-05T06:00:00+04:00", "3 h ago"],
    ["2026-11-03T16:00:00+04:00", "41 h ago"],
    ["2026-11-03T09:00:00+04:00", "2 d ago"],
    ["2026-10-26T09:00:00+04:00", "10 d ago"],
  ])("reads %s as %s", (raised, text) => {
    expect(ageText(raised, NOW)).toBe(text);
  });
});

describe("snooze choices", () => {
  it("offers 4 hours, tomorrow 07:00 and 3 days for an ordinary alert", () => {
    expect(snoozeChoices(NOW, "action_needed")).toEqual([
      { label: "4 hours", until: "2026-11-05T09:00:00.000Z" },
      { label: "Tomorrow 07:00", until: "2026-11-06T03:00:00.000Z" },
      { label: "3 days", until: "2026-11-08T05:00:00.000Z" },
    ]);
  });

  it("offers only what fits inside 24 hours for a critical alert", () => {
    expect(snoozeChoices(NOW, "critical").map((c) => c.label)).toEqual([
      "4 hours",
      "Tomorrow 07:00",
    ]); // 22 hours away
    expect(snoozeChoices("2026-11-05T03:00:00+04:00", "critical").map((c) => c.label)).toEqual([
      "4 hours",
    ]); // tomorrow 07:00 is 28 hours away
  });

  it("works out tomorrow in Gulf time even late in the evening", () => {
    const late = new Date("2026-11-05T22:30:00+04:00");
    expect(tomorrowMorning(late).toISOString()).toBe("2026-11-06T03:00:00.000Z");
  });

  it("turns a picked day into 07:00 that day", () => {
    expect(untilForDay("2026-11-09")).toBe("2026-11-09T03:00:00.000Z");
  });

  it("names the last day that may be picked", () => {
    expect(lastSnoozeDay(NOW, "action_needed")).toBe("2026-11-12");
    expect(lastSnoozeDay(NOW, "critical")).toBe("2026-11-06");
  });
});

describe("snoozeProblem", () => {
  it("says what the API would say", () => {
    expect(snoozeProblem("2026-11-05T08:00:00+04:00", NOW, "info")).toBe(
      "Choose a time in the future.",
    );
    expect(snoozeProblem("2026-11-07T09:00:00+04:00", NOW, "critical")).toBe(
      "A critical alert can be snoozed for 24 hours at most.",
    );
    expect(snoozeProblem("2026-11-13T09:00:00+04:00", NOW, "action_needed")).toBe(
      "An alert can be snoozed for 7 days at most.",
    );
  });

  it("accepts a time inside the cap, up to the cap itself", () => {
    expect(snoozeProblem("2026-11-06T09:00:00+04:00", NOW, "critical")).toBeNull();
    expect(snoozeProblem("2026-11-12T09:00:00+04:00", NOW, "info")).toBeNull();
  });
});

describe("factRows", () => {
  it("lays out a document alert's facts in order, in words", () => {
    const rows = factRows("document_expiry", {
      worker: "EMP-0088",
      worker_name: "Sanjeev Rana",
      document: "residency_visa",
      document_label: "Residency visa",
      expiry: "2026-11-12",
      days_left: 7,
      threshold: 7,
      project: "RAK-01",
    });
    expect(rows).toEqual([
      { label: "Worker", value: "Sanjeev Rana", kind: "text" },
      { label: "Code", value: "EMP-0088", kind: "code" },
      { label: "Document", value: "Residency visa", kind: "text" },
      { label: "Ends on", value: "12 Nov 2026", kind: "text" },
      { label: "Days left", value: "7", kind: "number" },
      { label: "Project", value: "RAK-01", kind: "code" },
    ]); // `threshold` is a detail for the detector, not for HR
  });

  it("says how long ago something ended and leaves out what is missing", () => {
    const rows = factRows("document_expiry", {
      worker: "EMP-0011",
      worker_name: "Farhan Khan",
      document_label: "Labour card",
      expiry: "2026-10-25",
      days_left: -11,
      project: null,
    });
    expect(rows.find((r) => r.label === "Days left")?.value).toBe("11 days ago");
    expect(rows.find((r) => r.label === "Project")).toBeUndefined();
  });

  it("lists people, and says how many more there are", () => {
    const rows = factRows("ending_without_next", {
      project: "RAK-02",
      end_date: "2026-11-15",
      days_left: 10,
      count: 25,
      workers: [
        { code: "EMP-0001", name: "Aamir Siddiqui" },
        { code: "EMP-0002", name: "Basil Thomas" },
      ],
      more: 23,
    });
    const who = rows.find((r) => r.label === "Who");
    expect(who?.value).toEqual([
      "Aamir Siddiqui (EMP-0001)",
      "Basil Thomas (EMP-0002)",
      "and 23 more",
    ]);
  });

  it("says plainly when the ban dates are only a planning assumption", () => {
    const rows = factRows("midday_ban_conflict", { provisional: true, project: "RAK-01" });
    expect(rows.find((r) => r.label === "Dates")?.value).toBe(
      "Provisional: HR's planning assumption",
    );
    expect(
      factRows("midday_ban_conflict", { provisional: false }).find((r) => r.label === "Dates")
        ?.value,
    ).toBe("Confirmed");
  });

  it("lists what is still to do on a checklist", () => {
    const rows = factRows("mobilization_stuck", {
      mob_no: "MOB-2026-0107",
      open_tasks: 2,
      open_titles: ["Verify residency visa and medical fitness", "Site induction"],
    });
    expect(rows.find((r) => r.label === "Still to do")?.value).toEqual([
      "Verify residency visa and medical fitness",
      "Site induction",
    ]);
  });

  it("has a name for every kind of alert", () => {
    expect(Object.keys(TYPE_LABEL)).toHaveLength(7);
    expect(TYPE_LABEL.document_expiry).toBe("Document");
  });
});
