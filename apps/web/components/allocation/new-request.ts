import type { NewRequestBody } from "@/lib/api-types";

/** The New-request form as the person edits it (numbers stay text until they are checked). */
export type RequestForm = {
  project: string;
  needed_from: string;
  needed_until: string;
  priority: string;
  note: string;
  lines: { id: number; trade: string; headcount: string; min_level: string }[];
};

export type RequestErrors = {
  project?: string;
  dates?: string;
  lines?: string;
  /** Per line id. */
  line: Record<number, { trade?: string; headcount?: string }>;
};

/** 1 is the most urgent: the board sorts by needed-from date, then priority, lowest first. */
export const PRIORITIES = [
  { value: "1", label: "1 · Urgent" },
  { value: "2", label: "2 · High" },
  { value: "3", label: "3 · Normal" },
  { value: "4", label: "4 · Low" },
  { value: "5", label: "5 · Lowest" },
] as const;

export const emptyForm = (): RequestForm => ({
  project: "",
  needed_from: "",
  needed_until: "",
  priority: "3",
  note: "",
  lines: [{ id: 1, trade: "", headcount: "", min_level: "" }],
});

/** The same checks the API makes, so most mistakes are caught before anything is sent. */
export function validate(form: RequestForm): RequestErrors {
  const errors: RequestErrors = { line: {} };
  if (!form.project) errors.project = "Choose the project the workers are for.";
  if (!form.needed_from) errors.dates = "Choose the date the workers are needed from.";
  else if (form.needed_until && form.needed_until < form.needed_from)
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

export const hasErrors = (e: RequestErrors) =>
  Boolean(e.project || e.dates || e.lines || Object.keys(e.line).length > 0);

export function toPayload(form: RequestForm): NewRequestBody {
  return {
    project: form.project,
    needed_from: form.needed_from,
    needed_until: form.needed_until || null,
    priority: Number(form.priority),
    source_text: form.note.trim() || null,
    lines: form.lines.map((l) => ({
      trade: l.trade,
      headcount: Number(l.headcount),
      min_level: l.min_level ? Number(l.min_level) : null,
    })),
  };
}
