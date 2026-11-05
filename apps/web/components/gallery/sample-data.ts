// Fictional sample data for the dev gallery only. Real screens read from the API.
import type { AlertView } from "@/components/ui/AlertCard";
import type { Exclusion, TraceStep } from "@/components/ui/AiAnswerCard";

export const SAMPLE_ALERTS: AlertView[] = [
  {
    id: "AL-1041",
    severity: "critical",
    title: "Visa expires in 7 days: Sanjeev Rana (EMP-0088) on RAK-01",
    project: "RAK-01",
    raised: "3 h ago",
    assignee: null,
  },
  {
    id: "AL-1044",
    severity: "action_needed",
    title: "RAK-07 starts 12 Feb 2027: 4 masons short",
    project: "RAK-07",
    raised: "3 h ago",
    assignee: "Priya Demo",
  },
  {
    id: "AL-1047",
    severity: "info",
    title: "RAK-01 site 2 shift breaks the provisional 2027 midday ban",
    project: "RAK-01",
    raised: "5 h ago",
    assignee: null,
  },
];

export type SampleWorker = {
  code: string;
  name: string;
  trade: string;
  level: number;
  docsUntil: string;
  available: string;
};

export const SAMPLE_WORKERS: SampleWorker[] = [
  {
    code: "EMP-0142",
    name: "Anil Kumar",
    trade: "Steel fixer",
    level: 4,
    docsUntil: "2027-08-03",
    available: "Now",
  },
  {
    code: "EMP-0107",
    name: "Bikash Rai",
    trade: "Steel fixer",
    level: 4,
    docsUntil: "2027-06-14",
    available: "Now",
  },
  {
    code: "EMP-0118",
    name: "Mohammed Salim",
    trade: "Steel fixer",
    level: 3,
    docsUntil: "2027-05-20",
    available: "Now",
  },
  {
    code: "EMP-0125",
    name: "Suresh Nair",
    trade: "Steel fixer",
    level: 3,
    docsUntil: "2027-03-30",
    available: "Now",
  },
  {
    code: "EMP-0139",
    name: "Kamal Hossain",
    trade: "Steel fixer",
    level: 3,
    docsUntil: "2027-07-19",
    available: "From 7 Nov",
  },
];

/** The agent's steps, in the order its tool calls complete. */
export const SAMPLE_STEPS: TraceStep[] = [
  {
    title: "Understood the request",
    detail: "8 × steel fixer, level 3+, from 8 Nov 2026; documents must cover to 3 Feb 2027.",
  },
  { title: "Checking visas", detail: "check_documents · 12 workers checked, 2 fail." },
  { title: "Checking availability", detail: "check_availability · 12 free from 8 Nov 2026." },
  { title: "Midday-ban check", detail: "check_work_rules · no ban in force on these dates." },
  { title: "8 cleared, 2 excluded", detail: "recommend_candidates · result stored for HR review." },
];

export const SAMPLE_EXCLUDED: Exclusion[] = [
  {
    name: "Faisal Ahmed",
    code: "EMP-0111",
    reason: "visa expires 12 Jan 2027, before 3 Feb 2027",
    rule: "DOC_VALID_THROUGH",
  },
  {
    name: "Prakash Shrestha",
    code: "EMP-0120",
    reason: "visa expires 20 Dec 2026, before 3 Feb 2027",
    rule: "DOC_VALID_THROUGH",
  },
];
