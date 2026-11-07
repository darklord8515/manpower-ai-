import type { Page, Route } from "@playwright/test";

/**
 * A pretend Workforce agent: a run takes a few polls, shows its steps one by one, then ends the way
 * the test asks. What the real agent does is tested in the API; here we test what the screen does
 * with the answers it gets.
 */

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, json: body, headers: {} });

const STARTED = "2026-11-05T05:00:00Z";

const RECOMMEND_STEPS = [
  {
    title: "Read the request line",
    detail: "Steel fixer: 7 needed for RAK-03 from 8 Nov 2026; 7 places open",
  },
  {
    title: "Searched the people who could be chosen",
    detail: "10 could be chosen, 3 left out by the rules",
  },
  { title: "Chose 3", detail: "1 dropped by the rules; 4 places left open" },
];

const PEOPLE = [
  { code: "EMP-0107", name: "Imran Qureshi", level: 4, group: "free", reason_by: "ai" as const },
  { code: "EMP-0112", name: "Saleem Akhtar", level: 4, group: "free", reason_by: "ai" as const },
  { code: "EMP-0117", name: "Rafiq Hussain", level: 4, group: "free", reason_by: "rules" as const },
];

const ANSWER =
  "RAK-07 needs 6 people in Test trade and 4 can be deployed. Recruit 2 by 13 Jan 2027, or have " +
  "2 start up to 12 days late.";

export type AgentOptions = {
  /** Which model tiers are on. Default: both. */
  off?: boolean;
  /** Starting a run is refused with this message. */
  refuseStart?: string;
  /** The run ends failed with this message. */
  fail?: string;
  /** The run recommends no one. */
  nobody?: boolean;
  /** Polls that answer "still running" before the run ends. Default 2. */
  slow?: number;
};

export async function mockAgent(page: Page, options: AgentOptions = {}) {
  const seen = {
    started: [] as Record<string, unknown>[],
    polls: 0,
  };
  let kind: "recommend_line" | "explain_forecast" = "recommend_line";
  let polls = 0;
  let runs = 0;

  await page.route("**/api/ai/status", (route) =>
    json(route, { light: !options.off, mid: !options.off }),
  );

  await page.route("**/api/agent/runs", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    seen.started.push(body);
    if (options.refuseStart) return json(route, { detail: options.refuseStart }, 503);
    kind = body.kind as typeof kind;
    polls = 0;
    runs += 1;
    return json(route, { id: `run-${runs}` }, 202);
  });

  await page.route(/\/api\/agent\/runs\/run-\d+$/, (route) => {
    seen.polls += 1;
    polls += 1;
    const id = route.request().url().split("/").pop() as string;
    const steps = kind === "recommend_line" ? RECOMMEND_STEPS : [FORECAST_STEP];
    const slow = options.slow ?? 2;
    const base = {
      id,
      kind,
      model: "fake-mid",
      tier: "mid",
      started_at: STARTED,
      recommendation: null,
      answer: null,
      error: null,
    };
    if (polls <= slow) {
      const shown = steps.slice(0, Math.min(polls, steps.length - 1));
      return json(route, { ...base, status: "running", steps: shown, finished_at: null });
    }
    if (options.fail) {
      return json(route, {
        ...base,
        status: "failed",
        steps: steps.slice(0, 1),
        error: options.fail,
        finished_at: STARTED,
      });
    }
    if (kind === "explain_forecast") {
      return json(route, {
        ...base,
        status: "succeeded",
        steps,
        answer: ANSWER,
        finished_at: STARTED,
      });
    }
    const people = options.nobody ? [] : PEOPLE;
    return json(route, {
      ...base,
      status: "succeeded",
      steps,
      finished_at: STARTED,
      recommendation: {
        trade: "Steel fixer",
        open_places: 7,
        shortfall: 7 - people.length,
        note: null,
        selections: people.map((p) => ({
          ...p,
          reason:
            p.reason_by === "ai"
              ? "Free now, level 4"
              : "Free now, level 4, documents valid to 30 Aug 2027",
        })),
        rejected: options.nobody
          ? []
          : [
              {
                code: "EMP-0132",
                name: "Anil Thapa",
                rule: "POLICY_LATE",
                message: "Would start late; HR decides who starts late.",
              },
            ],
      },
    });
  });

  return seen;
}

const FORECAST_STEP = { title: "Read the forecast", detail: "1 trade, 1 short, start 12 Feb 2027" };
