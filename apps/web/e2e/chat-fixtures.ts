import type { Page, Route } from "@playwright/test";

/**
 * A pretend Virtual HR server: a question takes a few polls, shows its steps one by one, then ends
 * with the answer the question's words ask for. What the real Supervisor does is tested in the API;
 * here we test what the screen does with the answers it gets.
 */

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, json: body, headers: {} });

const STARTED = "2026-11-05T05:00:00Z";

const STEPS = [
  { title: "Understood the question", detail: "workers, by the AI" },
  { title: "Searched the worker directory", detail: "12 workers found, 4 shown" },
];

type Answer = Record<string, unknown>;

const BASE = {
  why: "Understood by the AI as workers · available · Steel fixer. Searched the worker directory in your scope.",
  sources: [{ tool: "search_workers", as_of: "5 Nov 2026" }],
  agent: "workforce",
  ai_worded: false,
  python_only: false,
};

const WORKERS: Answer = {
  ...BASE,
  kind: "data",
  summary: "12 workers match (available, Steel fixer).",
  blocks: [
    {
      type: "table",
      title: null,
      columns: [
        { key: "code", label: "Code", align: "left" },
        { key: "name", label: "Name", align: "left" },
        { key: "trade", label: "Trade", align: "left" },
        { key: "level", label: "Level", align: "left" },
        { key: "status", label: "Status", align: "left" },
        { key: "project", label: "Project", align: "left" },
        { key: "document", label: "Next document", align: "left" },
      ],
      rows: [
        {
          code: "EMP-0142",
          name: "Anil Kumar",
          trade: "Steel fixer",
          level: 4,
          status: "available",
          project: null,
          document: "Residency visa, in 214 days",
        },
        {
          code: "EMP-0107",
          name: "Bikash Rai",
          trade: "Steel fixer",
          level: 4,
          status: "available",
          project: null,
          document: "Medical fitness, in 92 days",
        },
        {
          code: "EMP-0118",
          name: "Mohammed Salim",
          trade: "Steel fixer",
          level: 3,
          status: "available",
          project: null,
          document: "Labour card, in 197 days",
        },
        {
          code: "EMP-0125",
          name: "Suresh Nair",
          trade: "Steel fixer",
          level: 3,
          status: "available",
          project: null,
          document: "Residency visa, in 145 days",
        },
      ],
      total: 12,
      href: "/workers?trade=Steel+fixer&status=available",
    },
    { type: "note", tone: "info", text: "Showing the first 4 of 12. The screen has the rest." },
  ],
  actions: [
    { label: "Open these in Workers", href: "/workers?trade=Steel+fixer&status=available" },
  ],
};

const ALERTS: Answer = {
  ...BASE,
  kind: "data",
  summary: "18 alerts open: 2 critical, 16 need action and 0 are for information.",
  why: "Understood by the AI as alerts. Read the open alerts in your scope, most urgent first.",
  sources: [{ tool: "list_alerts", as_of: "5 Nov 2026" }],
  blocks: [
    {
      type: "kpis",
      items: [
        { label: "Critical", value: "2", tone: "bad" },
        { label: "Action needed", value: "16", tone: "warn" },
        { label: "Info", value: "0", tone: "neutral" },
      ],
    },
    {
      type: "alerts",
      total: 18,
      items: [
        {
          id: "alert-1",
          severity: "critical",
          title: "Anil Kumar’s residency visa ended 3 days ago",
          project: "RAK-02",
          raised: "4 Nov 2026",
        },
        {
          id: "alert-2",
          severity: "action_needed",
          title: "RAK-03 is 8 steel fixers short from 8 Nov 2026",
          project: "RAK-03",
          raised: "3 Nov 2026",
        },
      ],
    },
  ],
  actions: [{ label: "Open To-do", href: "/todo" }],
};

const FORECAST: Answer = {
  ...BASE,
  kind: "data",
  summary:
    "RAK-07 needs 24 people from 1 Dec 2026: 0 already assigned, 16 can be deployed and 4 are in recruitment; 4 are still uncovered (Mason).",
  why: "Understood by the AI as forecast · RAK-07. Read the manpower forecast; every number is Python’s.",
  sources: [{ tool: "forecast_availability", as_of: "5 Nov 2026" }],
  blocks: [
    {
      type: "kpis",
      items: [
        { label: "Needed", value: "24", tone: "neutral" },
        { label: "Already assigned", value: "0", tone: "neutral" },
        { label: "Can be deployed", value: "16", tone: "good" },
        { label: "In recruitment", value: "4", tone: "neutral" },
        { label: "Still uncovered", value: "4", tone: "bad" },
      ],
    },
    {
      type: "bars",
      title: "Covered against needed, by trade",
      items: [
        { label: "Mason", value: 6, of: 10, detail: "Recruit 4 by 13 Jan 2027" },
        { label: "Steel fixer", value: 8, of: 8, detail: "Covered" },
        { label: "General labour", value: 6, of: 6, detail: "Covered" },
      ],
    },
    {
      type: "table",
      title: null,
      columns: [
        { key: "trade", label: "Trade", align: "left" },
        { key: "needed", label: "Needed", align: "left" },
        { key: "deployable", label: "Deployable", align: "left" },
        { key: "uncovered", label: "Uncovered", align: "left" },
      ],
      rows: [
        { trade: "Mason", needed: 10, deployable: 6, uncovered: 4 },
        { trade: "Steel fixer", needed: 8, deployable: 8, uncovered: 0 },
        { trade: "General labour", needed: 6, deployable: 6, uncovered: 0 },
      ],
      total: 3,
      href: null,
    },
  ],
  actions: [{ label: "Open the forecast", href: "/projects/RAK-07/forecast" }],
};

const REFUSAL: Answer = {
  kind: "refusal",
  summary: "HAMRA AI holds no salary or pay data, so I cannot answer that.",
  blocks: [],
  why: "Salary is not stored in this system at all.",
  actions: [],
  sources: [],
  agent: null,
  ai_worded: false,
  python_only: false,
};

const CLARIFY: Answer = {
  kind: "clarify",
  summary:
    "I do not know the trade “unobtainium welders”. The trades are: Carpenter, Mason, Steel fixer.",
  blocks: [],
  why: "I need that to answer, and I will not guess.",
  actions: [],
  sources: [],
  agent: null,
  ai_worded: false,
  python_only: false,
};

const PYTHON_ONLY: Answer = {
  ...ALERTS,
  python_only: true,
  why: "Understood by keywords as alerts. Read the open alerts in your scope, most urgent first.",
};

export type ChatOptions = {
  /** Sending is refused with this message (429). */
  refuse?: string;
  /** Polls that answer "still running" before the answer. Default 2. */
  slow?: number;
  /** No model is set up. */
  off?: boolean;
  /** The conversations already saved. */
  saved?: { id: string; title: string; updated_at: string }[];
  /** The poll never gets an answer from the server. */
  deadPolls?: boolean;
};

export function answerFor(message: string, options: ChatOptions = {}): Answer {
  const text = message.toLowerCase();
  if (text.includes("salary")) return REFUSAL;
  if (text.includes("unobtainium")) return CLARIFY;
  if (text.includes("forecast") || text.includes("rak-07")) return FORECAST;
  if (text.includes("alert") || text.includes("attention"))
    return options.off ? PYTHON_ONLY : ALERTS;
  return WORKERS;
}

export async function mockChat(page: Page, options: ChatOptions = {}) {
  const seen = { sent: [] as Record<string, unknown>[], polls: 0, deleted: [] as string[] };
  const runs = new Map<string, { message: string; polls: number }>();
  let saved = [...(options.saved ?? [])];

  await page.route("**/api/assistant/suggestions", (route) =>
    json(route, {
      items: [
        "Who is available right now?",
        "What needs my attention today?",
        "Can we staff RAK-07?",
      ],
      ai_enabled: !options.off,
    }),
  );

  await page.route("**/api/assistant/messages", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    seen.sent.push(body);
    if (options.refuse) return json(route, { detail: options.refuse }, 429);
    const run = `run-${runs.size + 1}`;
    runs.set(run, { message: String(body.message), polls: 0 });
    const conversation = String(body.conversation_id ?? "conv-new");
    if (!body.conversation_id) {
      saved = [{ id: conversation, title: String(body.message), updated_at: STARTED }, ...saved];
    }
    return json(route, { run_id: run, conversation_id: conversation }, 202);
  });

  await page.route(/\/api\/assistant\/messages\/run-\d+$/, (route) => {
    seen.polls += 1;
    if (options.deadPolls) return route.abort();
    const id = route.request().url().split("/").pop() as string;
    const run = runs.get(id);
    if (!run) return json(route, { detail: "Answer not found" }, 404);
    run.polls += 1;
    const slow = options.slow ?? 2;
    const base = {
      id,
      conversation_id: "conv-new",
      model: options.off ? "python" : "groq:llama-3.3-70b-versatile",
      started_at: STARTED,
      error: null,
    };
    if (run.polls <= slow) {
      return json(route, {
        ...base,
        status: "running",
        steps: STEPS.slice(0, Math.min(run.polls, STEPS.length)),
        answer: null,
        finished_at: null,
      });
    }
    const answer = answerFor(run.message, options);
    return json(route, {
      ...base,
      status: answer.kind === "refusal" ? "refused" : "succeeded",
      steps: answer.kind === "data" ? STEPS : STEPS.slice(0, 1),
      answer,
      finished_at: STARTED,
    });
  });

  await page.route("**/api/assistant/conversations", (route) => json(route, saved));

  await page.route(/\/api\/assistant\/conversations\/[^/]+$/, (route) => {
    const id = route.request().url().split("/").pop() as string;
    if (route.request().method() === "DELETE") {
      seen.deleted.push(id);
      saved = saved.filter((c) => c.id !== id);
      return route.fulfill({ status: 204 });
    }
    const head = saved.find((c) => c.id === id);
    if (!head) return json(route, { detail: "Conversation not found" }, 404);
    return json(route, {
      ...head,
      messages: [
        {
          id: "m1",
          role: "user",
          content: head.title,
          answer: null,
          run_id: "run-old",
          created_at: STARTED,
        },
        {
          id: "m2",
          role: "assistant",
          content: String(answerFor(head.title, options).summary),
          answer: answerFor(head.title, options),
          run_id: "run-old",
          created_at: STARTED,
        },
      ],
    });
  });

  return seen;
}
