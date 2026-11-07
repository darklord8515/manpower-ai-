/**
 * What the Action Center needs that is not a component: how old an alert is, which snooze times
 * may be offered, and how an alert's facts are laid out. All of it is worked out from the server's
 * clock (`now` in every response), because the demo can run on a simulated date.
 */
import type { AlertSeverity, AlertType } from "./api-types";
import { formatDate } from "./format";

export const TYPE_LABEL: Record<AlertType, string> = {
  upcoming_shortfall: "Shortfall",
  ending_without_next: "Ending soon",
  document_expiry: "Document",
  mobilization_stuck: "Mobilization",
  transfer_dependency_broken: "Transfer",
  approval_waiting: "Approval",
  midday_ban_conflict: "Midday ban",
};

const HOUR = 3_600_000;
const GULF = 4 * HOUR; // the UAE has no daylight saving

/** "just now", "3 h ago", "2 d ago". */
export function ageText(raisedAt: string, now: string): string {
  const hours = Math.floor((new Date(now).getTime() - new Date(raisedAt).getTime()) / HOUR);
  if (hours < 1) return "just now";
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** The longest an alert may be snoozed (ALERT_SNOOZE): 24 hours if critical, else 7 days. */
export const snoozeLimitHours = (severity: AlertSeverity) =>
  severity === "critical" ? 24 : 7 * 24;

/** 07:00 Gulf time on a given Gulf calendar day. */
function morning(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 7) - GULF);
}

export function tomorrowMorning(now: Date): Date {
  const gulf = new Date(now.getTime() + GULF);
  return morning(gulf.getUTCFullYear(), gulf.getUTCMonth(), gulf.getUTCDate() + 1);
}

export type SnoozeChoice = { label: string; until: string };

/** The quick choices that fit under the cap: 4 hours, tomorrow 07:00, 3 days. */
export function snoozeChoices(now: string, severity: AlertSeverity): SnoozeChoice[] {
  const t = new Date(now);
  const cap = snoozeLimitHours(severity) * HOUR;
  const all: { label: string; at: Date }[] = [
    { label: "4 hours", at: new Date(t.getTime() + 4 * HOUR) },
    { label: "Tomorrow 07:00", at: tomorrowMorning(t) },
    { label: "3 days", at: new Date(t.getTime() + 72 * HOUR) },
  ];
  return all
    .filter((c) => c.at.getTime() - t.getTime() <= cap)
    .map((c) => ({ label: c.label, until: c.at.toISOString() }));
}

/** A picked calendar day (`2026-11-09`) as 07:00 Gulf time that day. */
export function untilForDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return morning(y, m - 1, d).toISOString();
}

/** The same checks the API makes, so a bad pick is caught before it is sent. */
export function snoozeProblem(until: string, now: string, severity: AlertSeverity): string | null {
  const wait = new Date(until).getTime() - new Date(now).getTime();
  if (!(wait > 0)) return "Choose a time in the future.";
  if (wait > snoozeLimitHours(severity) * HOUR)
    return severity === "critical"
      ? "A critical alert can be snoozed for 24 hours at most."
      : "An alert can be snoozed for 7 days at most.";
  return null;
}

/** The last day a person may pick for a snooze, as `YYYY-MM-DD` (Gulf time), for the date box. */
export function lastSnoozeDay(now: string, severity: AlertSeverity): string {
  const end = new Date(new Date(now).getTime() + snoozeLimitHours(severity) * HOUR + GULF);
  return end.toISOString().slice(0, 10);
}

export function gulfDay(iso: string): string {
  return new Date(new Date(iso).getTime() + GULF).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------------------------- facts

type Kind = "text" | "code" | "date" | "number" | "days" | "people" | "lines" | "provisional";

/** Which facts to show for each kind of alert, in order, and how to read them. */
const SPECS: Record<AlertType, [key: string, label: string, kind: Kind][]> = {
  upcoming_shortfall: [
    ["project", "Project", "code"],
    ["trade", "Trade", "text"],
    ["start", "Starts on", "date"],
    ["days_to_start", "Days to the start", "days"],
    ["needed", "Needed", "number"],
    ["already_assigned", "Already assigned", "number"],
    ["deployable", "Can be deployed", "number"],
    ["recruitment_pending", "Recruitment on the way", "number"],
    ["gap", "Still uncovered", "number"],
  ],
  ending_without_next: [
    ["project", "Project", "code"],
    ["end_date", "Last day", "date"],
    ["days_left", "Days left", "days"],
    ["count", "People", "number"],
    ["workers", "Who", "people"],
  ],
  document_expiry: [
    ["worker_name", "Worker", "text"],
    ["worker", "Code", "code"],
    ["document_label", "Document", "text"],
    ["expiry", "Ends on", "date"],
    ["days_left", "Days left", "days"],
    ["project", "Project", "code"],
  ],
  mobilization_stuck: [
    ["mob_no", "Mobilization", "code"],
    ["worker_name", "Worker", "text"],
    ["worker", "Code", "code"],
    ["project", "Project", "code"],
    ["report_on", "Reports on", "date"],
    ["days_to_report", "Days to the report", "days"],
    ["open_tasks", "Tasks open", "number"],
    ["overdue", "Tasks overdue", "number"],
    ["open_titles", "Still to do", "lines"],
  ],
  transfer_dependency_broken: [
    ["source", "Moving from", "code"],
    ["target", "Moving to", "code"],
    ["target_start", "Starts on", "date"],
    ["must_finish_by", "Must finish by", "date"],
    ["source_end", "Now ends on", "date"],
    ["count", "People", "number"],
    ["workers", "Who", "people"],
  ],
  approval_waiting: [
    ["request", "Request", "code"],
    ["project", "Project", "code"],
    ["waited_hours", "Hours waiting", "number"],
    ["since", "Sent", "date"],
  ],
  midday_ban_conflict: [
    ["project", "Project", "code"],
    ["site", "Site", "text"],
    ["year", "Ban year", "text"],
    ["provisional", "Dates", "provisional"],
    ["ban_starts", "Ban starts", "date"],
    ["ban_ends", "Ban ends", "date"],
    ["ban_window", "Not allowed between", "text"],
    ["shift", "Shift", "text"],
    ["people_up_to", "People (up to)", "number"],
  ],
};

export type FactRow = {
  label: string;
  /** One value, or several lines (a list of people, or what is still to do). */
  value: string | string[];
  kind: "text" | "code" | "number";
};

function days(n: number): string {
  if (n < 0) return `${-n} ${n === -1 ? "day" : "days"} ago`;
  if (n === 0) return "today";
  return String(n);
}

/** The facts table of one alert: only facts the detector gave, labelled and formatted for HR. */
export function factRows(type: AlertType, facts: Record<string, unknown>): FactRow[] {
  const rows: FactRow[] = [];
  for (const [key, label, kind] of SPECS[type]) {
    const raw = facts[key];
    if (raw === null || raw === undefined || raw === "") continue;
    switch (kind) {
      case "code":
        rows.push({ label, value: String(raw), kind: "code" });
        break;
      case "date":
        rows.push({ label, value: formatDate(String(raw)), kind: "text" });
        break;
      case "number":
        rows.push({ label, value: String(raw), kind: "number" });
        break;
      case "days":
        rows.push({ label, value: days(Number(raw)), kind: "number" });
        break;
      case "provisional":
        rows.push({
          label,
          value: raw ? "Provisional: HR's planning assumption" : "Confirmed",
          kind: "text",
        });
        break;
      case "lines":
        rows.push({ label, value: (raw as unknown[]).map(String), kind: "text" });
        break;
      case "people": {
        const list = (raw as { code: string; name: string }[]).map((w) => `${w.name} (${w.code})`);
        const more = Number(facts.more ?? 0);
        rows.push({ label, value: more > 0 ? [...list, `and ${more} more`] : list, kind: "text" });
        break;
      }
      default:
        rows.push({ label, value: String(raw), kind: "text" });
    }
  }
  return rows;
}

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Dubai",
});

/** "Detectors last ran at 09:00 on 5 Nov 2026." (Gulf time, like the rest of the product.) */
export function lastRunText(lastRun: string | null): string {
  if (!lastRun) return "The detectors have not run yet.";
  return `Detectors last ran at ${TIME.format(new Date(lastRun))} on ${formatDate(gulfDay(lastRun))}.`;
}
