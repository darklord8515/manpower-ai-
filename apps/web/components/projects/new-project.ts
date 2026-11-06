import type { NewProject } from "@/lib/api-types";

/** The Add-project form as the person edits it (numbers stay text until they are checked). */
export type ProjectForm = {
  name: string;
  starts_on: string;
  ends_on: string;
  outdoor: boolean;
  lines: { id: number; trade: string; headcount: string }[];
};

export type ProjectErrors = {
  name?: string;
  dates?: string;
  lines?: string;
  /** Per line id. */
  line: Record<number, { trade?: string; headcount?: string }>;
};

export const emptyForm = (): ProjectForm => ({
  name: "",
  starts_on: "",
  ends_on: "",
  outdoor: true,
  lines: [{ id: 1, trade: "", headcount: "" }],
});

/** The same checks the API makes, so most mistakes are caught before anything is sent. */
export function validate(form: ProjectForm): ProjectErrors {
  const errors: ProjectErrors = { line: {} };
  if (form.name.trim().length < 3)
    errors.name = "Give the project a name of at least 3 characters.";
  if (!form.starts_on || !form.ends_on) errors.dates = "Choose a start and an end date.";
  else if (form.ends_on < form.starts_on)
    errors.dates = "The end date must not be before the start date.";
  if (form.lines.length === 0) errors.lines = "Add at least one trade.";
  const seen = new Set<string>();
  for (const line of form.lines) {
    const problem: { trade?: string; headcount?: string } = {};
    if (!line.trade) problem.trade = "Choose a trade.";
    else if (seen.has(line.trade)) problem.trade = "This trade is already in the list.";
    else seen.add(line.trade);
    const n = Number(line.headcount);
    if (line.headcount.trim() === "" || !Number.isInteger(n) || n < 1 || n > 500)
      problem.headcount = "Enter a whole number from 1 to 500.";
    if (problem.trade || problem.headcount) errors.line[line.id] = problem;
  }
  return errors;
}

export const hasErrors = (e: ProjectErrors) =>
  Boolean(e.name || e.dates || e.lines || Object.keys(e.line).length > 0);

export function toPayload(form: ProjectForm): NewProject {
  return {
    name: form.name.trim(),
    starts_on: form.starts_on,
    ends_on: form.ends_on,
    outdoor: form.outdoor,
    lines: form.lines.map((l) => ({ trade: l.trade, headcount: Number(l.headcount) })),
  };
}
